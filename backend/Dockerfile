# The first stage contains TypeScript and development dependencies. It compiles
# source files into plain JavaScript but is not included in the final image.
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# The runtime stage contains only production dependencies and compiled output.
# This keeps compilers and source files out of the container that runs the API.
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 4000

# The official Node image includes this unprivileged account. The API does not
# need permission to modify the container operating system or application files.
USER node

CMD ["npm", "start"]
