FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS server-build
RUN apk add --no-cache python3 make g++
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/package.json ./package.json
COPY --from=client-build /app/client/dist ./public
ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/public
ENV DB_PATH=/app/data/uber-wled.db
EXPOSE 3000
CMD ["node", "dist/server.js"]
