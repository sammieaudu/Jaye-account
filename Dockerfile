FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
RUN npm run build -w apps/api
ENV NODE_ENV=production
ENV JAYE_MODE=hosted
ENV JAYE_DB_PATH=/data/jaye.db
ENV PORT=3001
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
