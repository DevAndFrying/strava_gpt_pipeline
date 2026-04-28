FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5174
ENV DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server.js ./

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 5174

CMD ["node", "server.js"]