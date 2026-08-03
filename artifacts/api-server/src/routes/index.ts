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
import facebookRouter from "./facebook";
import debugRouter from "./debug";
import calendarRouter from "./calendar";
import activityRouter from "./activity";
import emailDomainsRouter from "./email-domains";
import emailCampaignsRouter from "./email-campaigns";
import entitlementsRouter from "./entitlements";
import creditsRouter from "./credits";
import contactRouter from "./contact";
import paymentProvidersRouter from "./payment-providers";
import publicPaymentsRouter from "./public-payments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(debugRouter);
router.use(bookingsRouter);
router.use(clientsRouter);
router.use(servicesRouter);
router.use(staffRouter);
router.use(paymentsRouter);
router.use(analyticsRouter);
router.use(whatsappRouter);
router.use(facebookRouter);
router.use(calendarRouter);
// NOTE: the old ./subscriptions router was deliberately removed (2026-07-23).
// Subscription billing lives in the subscription-management Supabase edge
// function. The Express version had a check-status endpoint that activated
// subscriptions without payment verification and stale pre-rebrand prices —
// do not re-mount it.
router.use(activityRouter);
router.use(emailDomainsRouter);
router.use(emailCampaignsRouter);
router.use(entitlementsRouter);
router.use(creditsRouter);
router.use(contactRouter);
router.use(paymentProvidersRouter);
router.use(publicPaymentsRouter);

export default router;
