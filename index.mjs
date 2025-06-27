#!/usr/bin/env zx

import express from "express";
import http from "http";
import { $, argv } from "zx";
import { Server } from "socket.io";

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const port = process.env.PORT || 3005;

if (argv.build) {
  await $`npm run build`;
}

app.use(express.static("dist"));

console.log("zx here");

httpServer.listen(port, () => {
  console.log(`Server listening on port ${port} - http://localhost:${port}`);
});

io.on("connection", (socket) => {
  console.log("Socket connected", socket.id);

  socket.on("disconnect", (socket) => {
    console.log("Socket disconnected", socket.id);
  });
});
