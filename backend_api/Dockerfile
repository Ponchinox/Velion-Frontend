# Usa la imagen oficial de Node.js (versión 20 slim para balancear tamaño y compatibilidad con Prisma/FFMPEG)
FROM node:20-slim

# Crea el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Instalar openssl (requerido por Prisma en entornos Debian/Ubuntu)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copiar primero los archivos de dependencias para aprovechar el caché de Docker
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias (npm ci es más seguro y rápido en CI/CD que npm install)
RUN npm ci

# Generar el cliente Prisma (indispensable antes de arrancar el servidor)
RUN npx prisma generate

# Copiar el resto del código fuente del backend
COPY . .

# Exponer el puerto en el que corre Express
EXPOSE 3000

# Iniciar la aplicación usando el script de producción (node server.js)
CMD ["npm", "start"]
