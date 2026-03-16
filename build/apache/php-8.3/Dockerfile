FROM php:8.3-apache

RUN apt-get update && apt-get install -y \
    cron \
    default-mysql-client \
    git \
    gnupg \
    gzip \
    wget \
    curl \
    libbz2-dev \
    libfreetype6-dev \
    libicu-dev \
    libjpeg62-turbo-dev \
    libmagickwand-dev \
    libmcrypt-dev \
    libonig-dev \
    libpng-dev \
    libsodium-dev \
    libssh2-1-dev \
    libwebp-dev \
    libxslt1-dev \
    libzip-dev \
    lsof \
    mailutils \
    msmtp \
    procps \
    vim \
    zip \
    && rm -rf /var/lib/apt/lists/*

RUN a2enmod rewrite headers

RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf
RUN sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf

RUN docker-php-ext-configure \
    gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install \
    bcmath \
    bz2 \
    calendar \
    exif \
    gd \
    gettext \
    intl \
    mbstring \
    mysqli \
    opcache \
    pcntl \
    pdo_mysql \
    soap \
    sockets \
    sodium \
    sysvmsg \
    sysvsem \
    sysvshm \
    opcache \
    xsl \
    zip

# Install imagick via PECL
RUN pecl install imagick \
    && docker-php-ext-enable imagick

RUN apt-get update && apt-get install -y default-mysql-client

RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest

RUN apt-get update && apt-get install -y \
    libpcre2-8-0 \
    libpcre2-dev

# Instala o Xdebug
RUN pecl install xdebug && docker-php-ext-enable xdebug

RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

ADD /.docker/config/php.ini /usr/local/etc/php/php.ini
ADD /.docker/config/xdebug.ini /usr/local/etc/php/conf.d/xdebug.ini
ADD /.docker/apache/000-default.conf /etc/apache2/sites-available/000-default.conf
COPY /.docker/config/.env /usr/local/bin/.env
COPY /.docker/script/core.sh /usr/local/bin/core.sh
COPY /.docker/script/signature.sh /usr/local/bin/signature.sh
COPY /.docker/script/cache_laravel.sh /usr/local/bin/cache_laravel.sh
COPY /.docker/script/setup_laravel.sh /usr/local/bin/setup_laravel.sh

RUN chmod 777 -Rf /var/www /var/www/.* \
    && chown -Rf www-data:www-data /var/www /var/www/.* \
    && usermod -u 1000 www-data \
    && chsh -s /bin/bash www-data\
    && a2enmod rewrite \
    && a2enmod headers \
    && chmod +x /usr/local/bin/core.sh \
    && chmod +x /usr/local/bin/signature.sh \
    && chmod +x /usr/local/bin/cache_laravel.sh \
    && chmod +x /usr/local/bin/setup_laravel.sh 

VOLUME /var/www/html
WORKDIR /var/www/html