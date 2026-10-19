FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci
COPY apps ./apps
RUN npm run build
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV JAYE_MODE=local-shadow
EXPOSE 3000
CMD ["npm","start"]
