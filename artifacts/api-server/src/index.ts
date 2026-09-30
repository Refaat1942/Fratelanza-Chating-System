import { createServer } from "http";
import { Server as IOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable, conversationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapSeed } from "./lib/bootstrap-seed";
import { JWT_SECRET } from "./middlewares/auth";
import { processDueScheduledCampaigns } from "./lib/campaign-sender";

interface AuthedSocket extends Socket {
  data: { userId: number; role: "admin" | "agent" };
}

// A failed fire-and-forget background task must never take the whole API down.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

const io = new IOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  path: "/api/socket.io",
});

// Store io on app so routes can access it
app.set("io", io);

// JWT handshake auth — sockets must present a valid token
io.use(async (socket, next) => {
  try {
    const token =
      (socket.handshake.auth as { token?: string } | undefined)?.token ??
      (typeof socket.handshake.query["token"] === "string"
        ? (socket.handshake.query["token"] as string)
        : undefined);
    if (!token) return next(new Error("Unauthorized"));
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
    const [user] = await db
      .select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId));
    if (!user || !user.isActive) return next(new Error("Unauthorized"));
    (socket as AuthedSocket).data = { userId: user.id, role: user.role };
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

async function canAccessConversation(
  userId: number,
  role: "admin" | "agent",
  conversationId: number,
): Promise<boolean> {
  if (role === "admin") return true;
  const [conv] = await db
    .select({ assignedAgentId: conversationsTable.assignedAgentId })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId));
  if (!conv) return false;
  // Aligned with the HTTP read policy: agents may follow their own chats and
  // unassigned (queued) ones; sending still requires claiming the chat.
  return conv.assignedAgentId === null || conv.assignedAgentId === userId;
}

io.on("connection", (rawSocket) => {
  const socket = rawSocket as AuthedSocket;
  logger.info(
    { socketId: socket.id, userId: socket.data.userId },
    "Socket connected",
  );

  socket.on("join_conversation", async (conversationId: number) => {
    if (typeof conversationId !== "number" || !Number.isFinite(conversationId)) return;
    const ok = await canAccessConversation(
      socket.data.userId,
      socket.data.role,
      conversationId,
    );
    if (!ok) {
      logger.warn(
        { socketId: socket.id, userId: socket.data.userId, conversationId },
        "join_conversation denied",
      );
      return;
    }
    socket.join(`conv:${conversationId}`);
  });

  socket.on("leave_conversation", (conversationId: number) => {
    if (typeof conversationId !== "number") return;
    socket.leave(`conv:${conversationId}`);
  });

  socket.on(
    "typing",
    async ({
      conversationId,
      agentName,
    }: { conversationId: number; agentName: string }) => {
      if (typeof conversationId !== "number") return;
      const ok = await canAccessConversation(
        socket.data.userId,
        socket.data.role,
        conversationId,
      );
      if (!ok) return;
      socket
        .to(`conv:${conversationId}`)
        .emit("typing", { conversationId, agentName });
    },
  );

  socket.on(
    "message_status",
    ({ messageId, status }: { messageId: number; status: string }) => {
      if (typeof messageId !== "number") return;
      io.emit("message_status", { messageId, status });
    },
  );

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Socket disconnected");
  });
});

httpServer.listen(port, async () => {
  logger.info({ port }, "Server listening");
  await bootstrapSeed();
  setInterval(() => {
    void processDueScheduledCampaigns().catch((err) =>
      logger.error({ err }, "Scheduled campaign processor failed"),
    );
  }, 60_000);
});
