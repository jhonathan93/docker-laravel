# Mapa de Localização de Usuários

Dashboard interativo que exibe a distribuição geográfica dos usuários cadastrados no sistema, com dois níveis de visualização: **estado** (choropleth) e **cidade** (bolhas proporcionais ao número de usuários).

---

## Visão Geral

```
Usuário abre /dashboard/localizacao
        │
        ▼
Mapa do Brasil renderizado com Leaflet.js
Cada estado colorido por densidade de usuários
        │
        ▼ (clica em um estado)
Mapa faz zoom no estado
Bolhas aparecem em cada cidade com usuários
Painel lateral mostra ranking de cidades
        │
        ▼ (clica em "Voltar")
Retorna à visão de estados
```

---

## Pré-requisitos

### 1. Campos lat/lng na tabela addresses

Antes de qualquer coisa, é necessário adicionar `latitude` e `longitude` à tabela `addresses`.

**Criar a migration:**

```bash
docker compose exec app php artisan make:migration add_coordinates_to_addresses_table
```

**Conteúdo da migration:**

```php
public function up(): void
{
    Schema::table('addresses', function (Blueprint $table) {
        $table->decimal('latitude',  10, 7)->nullable()->after('country');
        $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
    });
}

public function down(): void
{
    Schema::table('addresses', function (Blueprint $table) {
        $table->dropColumn(['latitude', 'longitude']);
    });
}
```

**Rodar:**

```bash
docker compose exec app php artisan migrate
```

---

### 2. Preencher lat/lng ao salvar endereço

O serviço de geocodificação precisa ser chamado sempre que um endereço for criado ou atualizado.

**Onde chamar:** em `ProfileService::syncAddresses()`, após o `create` ou `update` do endereço, chamar o serviço de geocodificação passando o CEP/endereço completo e salvar lat/lng no registro.

**Exemplo de fluxo:**

```php
// Após criar ou atualizar o endereço
$coords = GeocodingService::getCoordinates($address->zip_code);
if ($coords) {
    $address->update([
        'latitude'  => $coords['lat'],
        'longitude' => $coords['lng'],
    ]);
}
```

---

### 3. GeoJSON dos estados do Brasil

O Leaflet precisa de um arquivo GeoJSON para desenhar os polígonos dos estados.

**Fonte:** dados simplificados do IBGE disponíveis publicamente.

**Download:**

```bash
# Dentro da pasta public/ do projeto
mkdir -p public/geojson

# Baixar GeoJSON dos estados (simplificado ~150kb)
curl -L "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson" \
     -o public/geojson/brazil-states.json
```

**Estrutura esperada do GeoJSON:**

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "São Paulo",
        "sigla": "SP"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [...]
      }
    }
  ]
}
```

> **Atenção:** o campo `sigla` no GeoJSON deve corresponder exatamente ao valor armazenado em `addresses.state` (ex: `"SP"`, `"RJ"`). Se o GeoJSON usar `abbreviation` ou `postal` em vez de `sigla`, ajustar no JS.

---

### 4. Instalar Leaflet.js

```bash
docker compose exec app npm install leaflet --save
```

---

## Arquitetura da Implementação

### Arquivos a criar/modificar

```
src/
├── app/
│   └── Http/Controllers/Main/Dashboard/
│       └── DashboardController.php          ← adicionar locationData()
├── database/migrations/
│   └── xxxx_add_coordinates_to_addresses.php ← nova migration
├── resources/
│   ├── css/dashboard/
│   │   └── map.css                          ← estilos do mapa
│   ├── js/actions/dashboard/
│   │   └── locationMap.js                   ← lógica do Leaflet
│   └── views/main/dashboard/
│       └── location.blade.php               ← view atualizada
├── routes/
│   └── web.php                              ← novas rotas de dados
└── public/
    └── geojson/
        └── brazil-states.json               ← baixar manualmente (ver acima)
```

---

## Backend — Endpoints de Dados

### Rota de estados

```
GET /dashboard/localizacao/estados
```

**Resposta:**

```json
{
  "SP": 42,
  "RJ": 18,
  "MG": 31,
  "RS": 7
}
```

**Lógica:** `addresses` agrupados por `state`, conta `DISTINCT user_id`.

```php
public function locationStates(): JsonResponse
{
    $data = Address::query()
        ->select('state', DB::raw('COUNT(DISTINCT user_id) as total'))
        ->whereNotNull('state')
        ->groupBy('state')
        ->pluck('total', 'state');

    return response()->json($data);
}
```

---

### Rota de cidades

```
GET /dashboard/localizacao/cidades/{state}
```

**Resposta:**

```json
{
  "cities": [
    { "city": "São Paulo",  "total": 20, "lat": -23.5505, "lng": -46.6333 },
    { "city": "Campinas",   "total": 8,  "lat": -22.9056, "lng": -47.0608 },
    { "city": "Santos",     "total": 3,  "lat": -23.9618, "lng": -46.3322 }
  ],
  "state": "SP",
  "total": 31
}
```

**Lógica:** filtra por estado, agrupa por cidade, pega a primeira lat/lng disponível de cada cidade.

```php
public function locationCities(string $state): JsonResponse
{
    $cities = Address::query()
        ->select(
            'city',
            DB::raw('COUNT(DISTINCT user_id) as total'),
            DB::raw('AVG(latitude)  as lat'),
            DB::raw('AVG(longitude) as lng')
        )
        ->where('state', strtoupper($state))
        ->whereNotNull('latitude')
        ->whereNotNull('longitude')
        ->groupBy('city')
        ->orderByDesc('total')
        ->get();

    return response()->json([
        'cities' => $cities,
        'state'  => strtoupper($state),
        'total'  => $cities->sum('total'),
    ]);
}
```

---

## Frontend — Leaflet Map

### Comportamento esperado

**Nível 1 — Visão Brasil (estados):**
- Mapa centralizado no Brasil
- Cada estado colorido por escala de intensidade baseada no total de usuários
- Hover: tooltip com nome do estado + total
- Click: drilla para o estado

**Nível 2 — Visão Estado (cidades):**
- Mapa faz zoom automático para os bounds do estado clicado
- Bolhas circulares em cada cidade, tamanho proporcional ao total de usuários
- Hover na bolha: tooltip com nome da cidade + total
- Painel lateral: ranking das cidades do estado
- Botão "Voltar" retorna para visão de estados

### Escala de cores (choropleth)

```
0 usuários    → #f0f4ff  (quase branco)
1–5           → #bfdbfe  (azul claro)
6–20          → #93c5fd  (azul médio)
21–50         → #3b82f6  (azul forte)
51–100        → #1d4ed8  (azul escuro)
100+          → #1e3a8a  (azul navy)
```

### Estrutura do JS

```javascript
// resources/js/actions/dashboard/locationMap.js

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const initLocationMap = (container) => {
    const statesUrl = container.dataset.statesUrl;   // rota para /estados
    const citiesUrl = container.dataset.citiesUrl;   // rota para /cidades/{state}
    const geoUrl    = container.dataset.geoUrl;      // /geojson/brazil-states.json

    // 1. Inicializar mapa
    const map = L.map(container, { zoomControl: true, scrollWheelZoom: true });

    // 2. Tile layer (OpenStreetMap ou sem tiles para mapa limpo)
    // Opcional: usar tiles neutros (CartoDB Positron)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap © CARTO'
    }).addTo(map);

    // 3. Carregar GeoJSON + dados e renderizar choropleth
    // 4. On click estado → buscar cidades e renderizar bolhas
    // 5. Painel lateral atualizado com ranking
};

document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('location-map');
    if (el) initLocationMap(el);
});
```

---

## View — location.blade.php

```blade
@extends('layouts.main')
@section('page-title', 'Localização')

@section('page-content')
<div class="flex gap-6 h-full">

    {{-- Mapa --}}
    <div class="flex-1 bg-surface border border-border rounded-md overflow-hidden">
        <div class="px-6 py-4 border-b border-border flex items-center justify-between">
            <div>
                <h2>Distribuição por Estado</h2>
                <p id="map-breadcrumb">Brasil</p>
            </div>
            <button id="map-back-btn" hidden>← Voltar</button>
        </div>
        <div
            id="location-map"
            data-states-url="{{ route('dashboard.location.states') }}"
            data-cities-url="{{ route('dashboard.location.cities', ['state' => '__STATE__']) }}"
            data-geo-url="{{ asset('geojson/brazil-states.json') }}"
            style="height: 520px;"
        ></div>
    </div>

    {{-- Painel lateral --}}
    <div class="w-72 shrink-0 bg-surface border border-border rounded-md">
        <div id="map-panel-states">...</div>
        <div id="map-panel-cities" hidden>...</div>
    </div>

</div>
@endsection
```

---

## CSS

```css
/* resources/css/dashboard/map.css */

#location-map { z-index: 0; }

/* Polígono de estado */
.state-layer {
    stroke: #ffffff;
    stroke-width: 1.5;
    transition: fill-opacity 0.2s;
}
.state-layer:hover { fill-opacity: 0.75; cursor: pointer; }

/* Bolha de cidade */
.city-bubble {
    stroke: #ffffff;
    stroke-width: 2;
    fill-opacity: 0.75;
    transition: fill-opacity 0.2s;
}
.city-bubble:hover { fill-opacity: 1; cursor: pointer; }
```

---

## Rotas a adicionar em web.php

```php
Route::prefix('dashboard')->group(function () {
    Route::get('/localizacao',                [DashboardController::class, 'location'])->name('dashboard.location');
    Route::get('/localizacao/estados',        [DashboardController::class, 'locationStates'])->name('dashboard.location.states');
    Route::get('/localizacao/cidades/{state}',[DashboardController::class, 'locationCities'])->name('dashboard.location.cities');
});
```

---

## Ordem de implementação recomendada

1. Criar e rodar a migration de lat/lng
2. Integrar o serviço de geocodificação em `ProfileService::syncAddresses()`
3. Baixar `brazil-states.json` para `public/geojson/`
4. `npm install leaflet`
5. Criar `map.css` e importar em `app.css`
6. Criar `locationMap.js`
7. Adicionar rotas e métodos no controller
8. Atualizar `location.blade.php`
9. Importar `locationMap.js` no bundle correto

---

## Dependências Externas

| Dependência | Versão | Uso |
|---|---|---|
| `leaflet` | ^1.9 | Renderização do mapa |
| `brazil-states.json` | IBGE | Polígonos dos estados |
| Serviço de geocodificação | interno | Preencher lat/lng nos endereços |

---

## Observações

- O mapa **não requer** GeoJSON de municípios — as cidades são plotadas como bolhas usando as coordenadas médias dos endereços cadastrados.
- Estados sem nenhum usuário são renderizados em cinza claro, sem interação de drill-down.
- Se um endereço não tiver lat/lng, ele contribui para a contagem do estado mas **não aparece** no nível de cidades. Por isso é importante garantir que o serviço de geocodificação seja chamado ao salvar endereços.
