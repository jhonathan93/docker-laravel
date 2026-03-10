# Geocoding em Background — Jobs, Queue e Redis

Funcionalidade que geocodifica CEPs em segundo plano usando Laravel Jobs + Queue com Redis.
O usuário dispara a tarefa com um clique e é notificado quando concluída.

---

## Visão Geral

```
Usuário clica "Atualizar Coordenadas"
        │
        ▼
POST /dashboard/localizacao/geocode
Controller cria um Bus::batch() com um Job por CEP pendente
Resposta imediata: { batch_id: "abc123" }
        │
        ▼ (background — worker Redis)
GeocodeZipCodeJob processa cada CEP
→ chama GeocodingService (Google Maps API)
→ salva lat/lng em cep_coordinates
        │
        ▼ (ao finalizar todos os jobs)
Batch::then() callback dispara
→ salva notificação no banco para o usuário
        │
        ▼ (frontend polling a cada 3s)
GET /dashboard/localizacao/geocode/{batch_id}/status
→ retorna progresso { total, processed, failed, finished }
→ quando finished = true, exibe notificação e recarrega mapa
```

---

## Pré-requisitos

### 1. Container Redis no Docker

Adicionar ao `docker-compose.yml`:

```yaml
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    networks:
      - laravel
```

Adicionar `redis` ao `depends_on` do serviço `app`:

```yaml
  app:
    depends_on:
      - mysql
      - mailhog
      - minio
      - redis        # ← adicionar
```

---

### 2. Variáveis de ambiente (.env)

```env
# Alterar de sync para redis
QUEUE_CONNECTION=redis

# Apontar para o serviço Docker (não 127.0.0.1)
REDIS_HOST=redis
REDIS_PASSWORD=null
REDIS_PORT=6379
```

---

### 3. Tabelas de infraestrutura do Laravel

```bash
# Tabela de controle de batches (jobs_batches)
docker compose exec app php artisan queue:batches-table
docker compose exec app php artisan migrate

# Tabela de jobs pendentes (jobs)
docker compose exec app php artisan queue:table
docker compose exec app php artisan migrate
```

---

### 4. Instalar predis (cliente Redis para PHP)

```bash
docker compose exec app composer require predis/predis
```

---

### 5. Worker em execução

O worker processa os jobs da fila. Em desenvolvimento:

```bash
docker compose exec app php artisan queue:work redis --queue=geocoding
```

Em produção, o ideal é um processo supervisor (Supervisor ou Docker service separado).

---

## Arquitetura de Arquivos

```
src/
├── app/
│   ├── Jobs/
│   │   └── GeocodeZipCodeJob.php          ← processa um CEP
│   ├── Models/
│   │   └── CepCoordinate.php              ← model da tabela cep_coordinates
│   ├── Services/
│   │   └── Geocoding/
│   │       └── CepCoordinateService.php   ← orquestra batch + cache
│   └── Http/Controllers/Main/Dashboard/
│       └── DashboardController.php        ← endpoints de disparo e status
└── routes/
    └── web.php                            ← novas rotas
```

---

## Model — CepCoordinate

```php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CepCoordinate extends Model {

    protected $fillable = ['cep', 'latitude', 'longitude'];

    /**
     * Retorna o CEP normalizado (sem hífen, 8 dígitos).
     */
    public static function normalize(string $cep): string {
        return preg_replace('/\D/', '', $cep);
    }

    /**
     * Busca coordenadas por CEP (aceita com ou sem hífen).
     */
    public static function findByCep(string $cep): ?static {
        return static::where('cep', static::normalize($cep))->first();
    }
}
```

---

## Job — GeocodeZipCodeJob

Processa **um único CEP** por execução. O Batch cuida de disparar N jobs em paralelo.

```php
namespace App\Jobs;

use App\Models\CepCoordinate;
use App\Services\Geocoding\GeocodingService; // serviço existente
use Illuminate\Bus\Batchable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class GeocodeZipCodeJob implements ShouldQueue {

    use Batchable, Queueable;

    public int $tries   = 3;           // tenta até 3 vezes em caso de falha
    public int $timeout = 30;          // timeout por job em segundos

    public function __construct(public readonly string $cep) {}

    public function handle(): void {
        // Se o batch foi cancelado, não processa
        if ($this->batch()?->cancelled()) return;

        // Se já existe na tabela, pula
        if (CepCoordinate::findByCep($this->cep)) return;

        // Chama o serviço de geocodificação existente
        $coords = GeocodingService::getCoordinates($this->cep);

        if (!$coords) return; // falha silenciosa — não quebra o batch

        CepCoordinate::create([
            'cep'       => CepCoordinate::normalize($this->cep),
            'latitude'  => $coords['lat'],
            'longitude' => $coords['lng'],
        ]);
    }
}
```

---

## Service — CepCoordinateService

Orquestra a criação do Batch e fornece o status.

```php
namespace App\Services\Geocoding;

use App\Jobs\GeocodeZipCodeJob;
use App\Models\Address;
use App\Models\CepCoordinate;
use Illuminate\Bus\Batch;
use Illuminate\Bus\PendingBatch;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Auth;

class CepCoordinateService {

    /**
     * Retorna todos os CEPs de endereços ainda sem coordenadas.
     */
    public static function pendingZipCodes(): array {
        $geocoded = CepCoordinate::pluck('cep')->map(fn($c) => $c)->toArray();

        return Address::query()
            ->whereNotNull('zip_code')
            ->get()
            ->map(fn($a) => CepCoordinate::normalize($a->zip_code))
            ->unique()
            ->reject(fn($cep) => in_array($cep, $geocoded))
            ->values()
            ->toArray();
    }

    /**
     * Dispara o batch de geocodificação em background.
     * Retorna o batch_id para polling de status.
     */
    public static function dispatchBatch(int $userId): string {
        $ceps = static::pendingZipCodes();

        $jobs = array_map(fn($cep) => new GeocodeZipCodeJob($cep), $ceps);

        $batch = Bus::batch($jobs)
            ->then(function (Batch $batch) use ($userId) {
                // Salvar notificação ao concluir
                // Implementar conforme sistema de notificações do projeto
                \Log::info("Geocoding batch {$batch->id} concluído para user {$userId}.");
            })
            ->catch(function (Batch $batch, \Throwable $e) {
                \Log::error("Batch {$batch->id} com falhas: {$e->getMessage()}");
            })
            ->onQueue('geocoding')
            ->name('Geocodificação de CEPs')
            ->dispatch();

        return $batch->id;
    }

    /**
     * Retorna o status atual de um batch.
     */
    public static function batchStatus(string $batchId): array {
        $batch = Bus::findBatch($batchId);

        if (!$batch) return ['error' => 'Batch não encontrado'];

        return [
            'total'      => $batch->totalJobs,
            'processed'  => $batch->processedJobs(),
            'failed'     => $batch->failedJobs,
            'pending'    => $batch->pendingJobs,
            'progress'   => $batch->progress(),   // 0–100
            'finished'   => $batch->finished(),
            'cancelled'  => $batch->cancelled(),
        ];
    }
}
```

---

## Controller — DashboardController (novos métodos)

```php
// POST /dashboard/localizacao/geocode
public function geocodeDispatch(): JsonResponse {
    $batchId = CepCoordinateService::dispatchBatch(Auth::id());

    return response()->json(['batch_id' => $batchId]);
}

// GET /dashboard/localizacao/geocode/{batchId}/status
public function geocodeStatus(string $batchId): JsonResponse {
    return response()->json(CepCoordinateService::batchStatus($batchId));
}
```

---

## Rotas — web.php

```php
Route::prefix('dashboard')->group(function () {
    Route::get( '/localizacao',                          [DashboardController::class, 'location'])->name('dashboard.location');
    Route::get( '/localizacao/estados',                  [DashboardController::class, 'locationStates'])->name('dashboard.location.states');
    Route::get( '/localizacao/cidades/{state}',          [DashboardController::class, 'locationCities'])->name('dashboard.location.cities');
    Route::post('/localizacao/geocode',                  [DashboardController::class, 'geocodeDispatch'])->name('dashboard.geocode.dispatch');
    Route::get( '/localizacao/geocode/{batchId}/status', [DashboardController::class, 'geocodeStatus'])->name('dashboard.geocode.status');
});
```

---

## Frontend — Polling de Status

```javascript
// Após clicar no botão "Atualizar Coordenadas"

const startGeocoding = async (dispatchUrl, statusUrl) => {
    // 1. Dispara o batch
    const res     = await fetch(dispatchUrl, { method: 'POST', headers: { 'X-CSRF-TOKEN': csrf } });
    const { batch_id } = await res.json();

    // 2. Inicia polling a cada 3 segundos
    const interval = setInterval(async () => {
        const status = await fetch(statusUrl.replace('{batchId}', batch_id)).then(r => r.json());

        updateProgressBar(status.progress); // atualiza barra de progresso

        if (status.finished) {
            clearInterval(interval);
            notify.success(`Geocodificação concluída! ${status.processed} CEPs atualizados.`);
            reloadMap(); // recarrega o mapa com novos dados
        }

        if (status.failed > 0) {
            // Exibe aviso mas não para o polling (o batch continua)
            console.warn(`${status.failed} CEPs falharam.`);
        }
    }, 3000);
};
```

---

## Resposta do endpoint de status

```json
{
  "total":     150,
  "processed": 87,
  "failed":    2,
  "pending":   61,
  "progress":  58,
  "finished":  false,
  "cancelled": false
}
```

---

## Ordem de Implementação

1. Adicionar Redis ao `docker-compose.yml` e subir o container
2. Atualizar `.env` (`QUEUE_CONNECTION=redis`, `REDIS_HOST=redis`)
3. Instalar `predis/predis` via composer
4. Rodar `queue:batches-table` + `queue:table` + `migrate`
5. Criar `CepCoordinate` model
6. Criar `GeocodeZipCodeJob`
7. Criar `CepCoordinateService`
8. Adicionar métodos ao `DashboardController`
9. Adicionar rotas ao `web.php`
10. Criar JS de polling e botão na view
11. Subir o worker: `php artisan queue:work redis --queue=geocoding`

---

## Observações

- O serviço de geocodificação (`GeocodingService`) **já existe** no projeto com Google Maps API configurada via `GEOCODING_DEFAULT_PROVIDER=google` e `GOOGLE_MAPS_API_KEY`.
- CEPs que falharem na geocodificação são ignorados silenciosamente — o batch continua e o job não quebra.
- O mesmo CEP nunca é geocodificado duas vezes (verificação no início do `handle()`).
- Em produção, o worker deve ser mantido ativo via Supervisor ou como serviço Docker separado.
- O polling de 3s é leve — cada requisição retorna apenas um JSON simples consultando a tabela `job_batches`.
