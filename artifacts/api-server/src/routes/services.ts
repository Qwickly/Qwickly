import { Router } from "express";
import { store } from "../data/store";

const router = Router();

router.get("/services", async (req, res) => {
  try {
    const services = [...store.services].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    res.json(services.map((s) => ({
      id: s.id, name: s.name, description: s.description,
      price: Number(s.price), duration: s.duration,
      depositRequired: s.depositRequired, depositAmount: Number(s.depositAmount),
      bookingCount: s.bookingCount, color: s.color, imageUrl: s.imageUrl ?? null,
      isActive: s.isActive, staffIds: [], createdAt: s.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/services", async (req, res) => {
  try {
    const { name, description, price, duration, depositRequired, depositAmount, color, staffIds } = req.body;
    const svc = {
      id: store.nextId.service++,
      name,
      description: description ?? "",
      price: String(price),
      duration: Number(duration),
      depositRequired: depositRequired ?? false,
      depositAmount: String(depositAmount ?? 0),
      bookingCount: 0,
      color: color ?? "#10b981",
      imageUrl: null,
      isActive: true,
      createdAt: new Date(),
    };
    store.services.push(svc);
    res.status(201).json({
      id: svc.id, name: svc.name, description: svc.description,
      price: Number(svc.price), duration: svc.duration,
      depositRequired: svc.depositRequired, depositAmount: Number(svc.depositAmount),
      bookingCount: 0, color: svc.color, imageUrl: null,
      isActive: svc.isActive, staffIds: staffIds ?? [], createdAt: svc.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/services/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const s = store.services.find((x) => x.id === id);
    if (!s) return res.status(404).json({ error: "Not found" });
    res.json({
      id: s.id, name: s.name, description: s.description,
      price: Number(s.price), duration: s.duration,
      depositRequired: s.depositRequired, depositAmount: Number(s.depositAmount),
      bookingCount: s.bookingCount, color: s.color, imageUrl: s.imageUrl ?? null,
      isActive: s.isActive, staffIds: [], createdAt: s.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/services/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const s = store.services.find((x) => x.id === id);
    if (!s) return res.status(404).json({ error: "Not found" });

    if (req.body.name !== undefined) s.name = req.body.name;
    if (req.body.description !== undefined) s.description = req.body.description;
    if (req.body.price !== undefined) s.price = String(req.body.price);
    if (req.body.duration !== undefined) s.duration = Number(req.body.duration);
    if (req.body.depositRequired !== undefined) s.depositRequired = req.body.depositRequired;
    if (req.body.depositAmount !== undefined) s.depositAmount = String(req.body.depositAmount);
    if (req.body.color !== undefined) s.color = req.body.color;
    if (req.body.isActive !== undefined) s.isActive = req.body.isActive;

    res.json({
      id: s.id, name: s.name, description: s.description,
      price: Number(s.price), duration: s.duration,
      depositRequired: s.depositRequired, depositAmount: Number(s.depositAmount),
      bookingCount: s.bookingCount, color: s.color, imageUrl: s.imageUrl ?? null,
      isActive: s.isActive, staffIds: [], createdAt: s.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/services/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const s = store.services.find((x) => x.id === id);
    if (s) s.isActive = false;
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
