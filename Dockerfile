# AquaSense – dashboard + control server (no npm dependencies)
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public \
    TZ=Asia/Ho_Chi_Minh

WORKDIR /app

# only the files the server actually serves (no .git, no server code in public/)
COPY server/ ./server/
COPY index.html ./public/index.html
COPY assets/ ./public/assets/
COPY control/ ./public/control/

RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["node", "server/server.js"]
