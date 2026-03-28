# Angular Client Dockerfile
FROM node:25 AS builder

WORKDIR /app
COPY plnd_client .

RUN npm ci && \
    npx ng build --configuration production

FROM nginx:alpine

COPY --from=builder /app/dist/plnd_client/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 4200
CMD ["nginx", "-g", "daemon off;"]
