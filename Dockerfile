FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
# config.toml (and state.json next to it) live in the mounted /config folder.
ENTRYPOINT ["node", "src/index.js", "--config", "/config/config.toml"]
CMD ["--watch"]
