FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS server-build
RUN apk add --no-cache python3 make g++
WORKDIR /app/server
COPY server/package.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# Footer (__APP_VERSION__) is client/package.json; /api/version is
# server/package.json. A mismatch makes the reload banner lie, so fail the
# image build rather than ship two numbers.
FROM node:20-alpine AS version-check
WORKDIR /check
COPY client/package.json ./client.json
COPY server/package.json ./server.json
RUN node -e "const c=require('./client.json'); const s=require('./server.json'); if (c.version!==s.version) { console.error('client/server version drift: client='+c.version+' server='+s.version+' — bump both package.json files to the same version'); process.exit(1); }"

FROM node:20-alpine
WORKDIR /app
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/package.json ./package.json
COPY --from=client-build /app/client/dist ./public
COPY --from=version-check /check/client.json ./.client-version.json
ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/public
ENV DB_PATH=/app/data/uber-wled.db
EXPOSE 3000
CMD ["node", "dist/server.js"]
