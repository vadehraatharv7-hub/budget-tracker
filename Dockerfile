# Stage 1: build the web app (Vite + TypeScript). Dev dependencies stay in this stage.
FROM node:25-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY web ./web
RUN npm run build

# Stage 2: the runtime image only carries the server, its one production dependency and the built web app.
FROM node:25-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/budget.db TZ=Europe/Copenhagen
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
