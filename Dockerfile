FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
# git: clone the repo. docker-cli: start Trivy as a container through the mounted Docker socket.
RUN apk add --no-cache git docker-cli
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 3000
# the heap limit sits below the container limit (mem_limit in docker-compose.yml)
CMD ["node", "--max-old-space-size=150", "dist/index.js"]
