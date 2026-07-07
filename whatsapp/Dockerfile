FROM node:24-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package*.json ./
COPY patches ./patches
RUN npm install --omit=dev

COPY src/ ./src/