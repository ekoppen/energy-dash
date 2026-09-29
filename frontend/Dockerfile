# frontend/Dockerfile — Vite build, geserveerd door nginx
# Multi-stage: bouwen met Node, serveren met een kleine nginx.

# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
# package-lock.json is meegeleverd → deterministische, snelle install.
RUN npm ci

COPY . .

# API-basis wordt tijdens build ingebakken (default /api → nginx proxyt door)
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# --- serve stage ---
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
