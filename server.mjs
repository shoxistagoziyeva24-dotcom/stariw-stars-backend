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
        throw new Error(
          "Telegram seller session avtorizatsiyadan o'tmagan"
        );
      }

      return client;
    })().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }

  return clientPromise;
}

function auth(req, res, next) {
  const secret = req.get("x-stariw-secret");

  if (secret !== SECRET) {
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
    throw new Error(
      "Bot akkauntiga Stars yuborib bo'lmaydi"
    );
  }

  if (entity.deleted) {
    throw new Error(
      "Telegram akkaunti o'chirilgan"
    );
  }

  if (!entity.accessHash) {
    throw new Error(
      "Telegram foydalanuvchisini aniqlab bo'lmadi"
    );
  }

  console.log("[stariw] User resolved:", clean);

  return entity;
}

async function getSellerStars() {
  const client = await getClient();

  console.log(
    "[stariw] Checking seller Stars balance..."
  );

  const status = await client.invoke(
    new Api.payments.GetStarsStatus({
      peer: new Api.InputPeerSelf()
    })
  );

  const amount = Number(
    status?.balance?.amount ?? 0
  );

  console.log(
    "[stariw] Seller Stars:",
    amount
  );

  return amount;
}

async function getGiftOption(username, stars) {
  const client = await getClient();

  const user = await findUser(username);

  console.log(
    "[stariw] Getting Stars gift options:",
    stars
  );

  const options = await client.invoke(
    new Api.payments.GetStarsGiftOptions({
      userId: makeInputUser(user)
    })
  );

  const list = Array.isArray(options)
    ? options
    : [];

  console.log(
    "[stariw] Gift options received:",
    list.length
  );

  const normalOption = list.find(
    (item) =>
      Number(item.stars) === stars &&
      !item.extended
  );

  const anyOption = list.find(
    (item) =>
      Number(item.stars) === stars
  );

  const option =
    normalOption || anyOption;

  if (!option) {
    throw new Error(
      `Telegram ${stars} Stars uchun gift variantini bermadi`
    );
  }

  console.log(
    "[stariw] Gift option found:",
    {
      stars: Number(option.stars),
      currency: option.currency,
      amount: String(option.amount)
    }
  );

  return {
    client,
    user,
    option
  };
}

async function deliverStars(username, stars) {
  const data = await getGiftOption(
    username,
    stars
  );

  const client = data.client;
  const user = data.user;
  const option = data.option;

  console.log(
    "[stariw] Creating Stars gift invoice..."
  );

  const purpose =
    new Api.InputStorePaymentStarsGift({
      userId: makeInputUser(user),
      stars: BigInt(stars),
      currency: option.currency,
      amount: BigInt(option.amount)
    });

  const invoice =
    new Api.InputInvoiceStars({
      purpose
    });

  console.log(
    "[stariw] Getting payment form..."
  );

  const form = await client.invoke(
    new Api.payments.GetPaymentForm({
      invoice
    })
  );

  console.log(
    "[stariw] Sending Stars payment..."
  );

  const result = await client.invoke(
    new Api.payments.SendStarsForm({
      formId: form.formId,
      invoice
    })
  );

  const transactionId =
    result?.transactionId
      ? String(result.transactionId)
      : null;

  console.log(
    "[stariw] Stars delivery SUCCESS:",
    transactionId || "no transaction id"
  );

  return {
    transactionId
  };
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "stariw-stars",
    time: new Date().toISOString()
  });
});

app.get(
  "/debug/stars",
  auth,
  async (req, res) => {
    try {
      const stars =
        await getSellerStars();

      res.json({
        ok: true,
        sellerStars: stars
      });
    } catch (error) {
      console.error(
        "[stariw] DEBUG ERROR:",
        error
      );

      res.status(502).json({
        ok: false,
        error:
          error?.message ||
          "Telegram Stars tekshiruvi xatosi"
      });
    }
  }
);

app.post(
  "/preflight",
  auth,
  async (req, res) => {
    try {
      const stars = Number(
        req.body?.stars
      );

      if (
        !Number.isInteger(stars) ||
        stars <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Stars miqdori noto'g'ri"
        });
      }

      console.log(
        "[stariw] PREFLIGHT:",
        stars
      );

      const sellerStars =
        await getSellerStars();

      if (sellerStars < stars) {
        return res.json({
          ok: true,
          ready: false,
          sellerStars,
          error:
            "Seller Stars zaxirasi yetarli emas"
        });
      }

      res.json({
        ok: true,
        ready: true,
        sellerStars
      });
    } catch (error) {
      console.error(
        "[stariw] PREFLIGHT ERROR:",
        error
      );

      res.status(502).json({
        ok: false,
        error:
          error?.message ||
          "Telegram ulanish xatosi"
      });
    }
  }
);

app.post(
  "/deliver",
  auth,
  async (req, res) => {
    try {
      const stars = Number(
        req.body?.stars
      );

      const username =
        normalizeUsername(
          req.body?.username
        );

      if (
        !Number.isInteger(stars) ||
        stars <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Stars miqdori noto'g'ri"
        });
      }

      if (!username) {
        return res.status(400).json({
          ok: false,
          error:
            "Username kiritilmagan"
        });
      }

      console.log(
        "[stariw] DELIVERY REQUEST:",
        {
          username,
          stars
        }
      );

      const sellerStars =
        await getSellerStars();

      if (sellerStars < stars) {
        return res.status(409).json({
          ok: false,
          error:
            "Seller Stars zaxirasi yetarli emas",
          sellerStars
        });
      }

      const result =
        await deliverStars(
          username,
          stars
        );

      res.json({
        ok: true,
        transactionId:
          result.transactionId,
        stars,
        username
      });
    } catch (error) {
      console.error(
        "[stariw] DELIVERY ERROR:",
        error
      );

      res.status(502).json({
        ok: false,
        error:
          error?.message ||
          "Stars yetkazilmadi"
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(
    `[stariw] Stars backend listening on ${PORT}`
  );
});
