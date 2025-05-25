# Use a lightweight Node.js image suitable for Raspberry Pi (arm64/armv7)
FROM node:20-slim

# Set working directory inside the container
WORKDIR /app

# Copy only the package.json and lockfile to install deps first
COPY public_bot/package*.json ./public_bot/

# Install dependencies
WORKDIR /app/public_bot
RUN npm install

# Go back to base workdir to copy everything
WORKDIR /app
COPY . .

# Set environment variables
ENV NODE_ENV=production

# Run the bot
CMD ["node", "public_bot/index.js"]
