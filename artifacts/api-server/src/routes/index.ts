import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import bookingsRouter from "./bookings";
import clientsRouter from "./clients";
import servicesRouter from "./services";
import staffRouter from "./staff";
import paymentsRouter from "./payments";
import analyticsRouter from "./analytics";
import whatsappRouter from "./whatsapp";
import calendarRouter from "./calendar";
import subscriptionsRouter from "./subscriptions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(bookingsRouter);
router.use(clientsRouter);
router.use(servicesRouter);
router.use(staffRouter);
router.use(paymentsRouter);
router.use(analyticsRouter);
router.use(whatsappRouter);
router.use(calendarRouter);
router.use(subscriptionsRouter);

export default router;
