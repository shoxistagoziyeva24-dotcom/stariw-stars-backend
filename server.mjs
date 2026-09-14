import express from "express";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const app = express();
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 10000);

const API_ID = Number(process.env.TG_API_ID);
const API_HASH = process.env.TG_API_HASH;
const SESSION = process.env.TG_SESSION;
const SECRET = process.env.STARS_BACKEND_SECRET;

if (!API_ID || !API_HASH || !SESSION || !SECRET) {
  throw new Error(
    "TG_API_ID, TG_API_HASH, TG_SESSION, STARS_BACKEND_SECRET kerak"
  );
}

let clientPromise = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      console.log("[stariw] Telegram client connecting...");

      const client = new TelegramClient(
        new StringSession(SESSION),
        API_ID,
        API_HASH,
        {
          connectionRetries: 5,
          useWSS: false,
          useIPV6: false
        }
      );

      await client.connect();

      const authorized = await client.checkAuthorization();

      console.log("[stariw] Telegram authorized:", authorized);

      if (!authorized) {
        throw new Error("Telegram seller session avtorizatsiyadan o'tmagan");
      }

      return client;
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }

  return clientPromise;
}

function auth(req, res, next) {
  if (req.get("x-stariw-secret") !== SECRET) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  next();
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function makeInputUser(entity) {
  return new Api.InputUser({
    userId: entity.id,
    accessHash: entity.accessHash
  });
}

async function findUser(username) {
  const client = await getClient();
  const clean = normalizeUsername(username);

  if (!clean) {
    throw new Error("Username kiritilmagan");
  }

  console.log("[stariw] Resolving user:", clean);

  const entity = await client.getEntity("@" + clean);

  if (!entity || entity.className !== "User") {
    throw new Error("Telegram foydalanuvchisi topilmadi");
  }

  if (entity.bot) {
    throw new Error("Bot akkauntiga Stars yuborib bo'lmaydi");
  }

  if (entity.deleted) {
    throw new Error("Telegram akkaunti o'chirilgan");
  }

  if (!entity.accessHash) {
    throw new Error("Telegram foydalanuvchisini aniqlab bo'lmadi");
  }

  console.log("[stariw] User resolved:", clean);

  return entity;
}

async function getSellerStars() {
  const client = await getClient();

  console.log("[stariw] Checking seller Stars balance...");

  const status = await client.invoke(
    new Api.payments.GetStarsStatus({
      peer: new Api.InputPeerSelf()
    })
  );

  const amount = Number(status?.balance?.amount ?? 0);

  console.log("[stariw] Seller Stars:", amount);

  return amount;
}

async function getGiftOption(username, stars) {
  const client = await getClient();
  const user = await findUser(username);

  console.log("[stariw] Getting Stars gift options:", stars);

  const options = await client.invoke(
    new Api.payments.GetStarsGiftOptions({
      userId: makeInputUser(user)
    })
  );

  console.log(
    "[stariw] Gift options received:",
    Array.isArray(options) ? options.length : 0
  );

  const list = Array.isArray(options) ? options : [];

  const exactNormal = list.find(
    (item) =>
      Number(item.stars) === stars &&
      !item.extended
  );

  const exactAny = list.find(
    (item) => Number(item.stars) === stars
  );

  const option = exactNormal || exactAny;

  if (!option) {
    throw new Error(
      `Telegram ${stars} Stars uchun gift variantini bermadi`
    );
  }

  console.log("[stariw] Gift option found:", {
    stars: Number(option.stars),
    currency: option.currency,
    amount: String(option.amount)
  });

  return {
    client,
    user,
    option
  };
}

async function deliverStars(username, stars) {
  const { client, user, option } = await getGiftOption(
    username,
    stars
 
