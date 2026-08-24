FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY db ./db
COPY drizzle ./drizzle

ENV NODE_ENV=production
EXPOSE 5000

CMD ["npm", "start"]
