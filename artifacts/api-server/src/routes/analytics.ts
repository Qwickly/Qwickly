import { Router } from "express";

const router = Router();

router.get("/analytics/overview", async (req, res) => {
  try {
    const period = (req.query.period as string) ?? "30d";
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;

    const revenueData = [];
    const bookingsData = [];
    const clientsData = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = d.toISOString().split("T")[0];
      revenueData.push({ date: label, revenue: Math.round(Math.random() * 5000 + 1000), bookings: 0 });
      bookingsData.push({ date: label, revenue: 0, bookings: Math.round(Math.random() * 25 + 5) });
      clientsData.push({ date: label, revenue: 0, bookings: Math.round(Math.random() * 8 + 1) });
    }

    const heatmapData = [];
    const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (const day of daysOfWeek) {
      for (let h = 8; h <= 18; h++) {
        heatmapData.push({ day, hour: h, value: Math.round(Math.random() * 10) });
      }
    }

    const serviceBreakdown = [
      { id: 1, name: "Haircut", bookingCount: 142, revenue: 21300, percentageOfTotal: 43 },
      { id: 2, name: "Color & Highlights", bookingCount: 89, revenue: 26700, percentageOfTotal: 28 },
      { id: 3, name: "Beard Trim", bookingCount: 67, revenue: 6700, percentageOfTotal: 15 },
      { id: 4, name: "Facial Treatment", bookingCount: 34, revenue: 10200, percentageOfTotal: 8 },
      { id: 5, name: "Manicure", bookingCount: 22, revenue: 4400, percentageOfTotal: 4 },
      { id: 6, name: "Massage", bookingCount: 12, revenue: 7200, percentageOfTotal: 2 },
    ];

    res.json({
      revenueData,
      bookingsData,
      clientsData,
      retentionRate: 73.4,
      noShowRate: 8.2,
      heatmapData,
      serviceBreakdown,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/analytics/ai-insights", async (req, res) => {
  try {
    res.json([
      { id: 1, text: "Wednesday is your busiest day — consider adding extra staff coverage", type: "neutral", impact: "high" },
      { id: 2, text: "Haircuts generate 43% of your total revenue", type: "positive", impact: "high" },
      { id: 3, text: "No-shows decreased 18% after implementing WhatsApp reminders", type: "positive", impact: "high" },
      { id: 4, text: "Saturday afternoons have high demand but low staff availability", type: "warning", impact: "medium" },
      { id: 5, text: "VIP clients spend 3.2x more than average clients", type: "opportunity", impact: "high" },
      { id: 6, text: "Client retention rate improved 12% this quarter", type: "positive", impact: "medium" },
    ]);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
