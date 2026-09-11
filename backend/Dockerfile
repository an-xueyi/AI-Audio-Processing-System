# The first stage contains TypeScript and development dependencies. It compiles
# source files into plain JavaScript but is not included in the final image.
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# After TypeScript has been compiled, development-only packages such as the
# compiler and test runner are no longer needed. Pruning them here creates the
# exact production node_modules directory copied into the final image below.
RUN npm prune --omit=dev

# The runtime stage contains only production dependencies and compiled output.
# This keeps compilers and source files out of the container that runs the API.
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install current Alpine security fixes. The npm command-line program is useful
# while building an application, but the running container starts compiled
# JavaScript directly with Node. Removing npm also removes its large dependency
# tree from the network-facing runtime image.
RUN apk upgrade --no-cache \
    && rm -rf \
    /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm \
    /usr/local/bin/npx

# --chown makes the unprivileged `node` account own the application files.
# The final image receives production dependencies and compiled JavaScript only;
# TypeScript source, tests, and build tools remain in the discarded build stage.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

EXPOSE 4000

# The official Node image includes this unprivileged account. The API does not
# need permission to modify the container operating system or application files.
USER node

CMD ["node", "dist/server.js"]
