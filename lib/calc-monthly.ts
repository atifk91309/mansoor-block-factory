import BlockDailyModel from "@/models/BlockDaily";
import MonthlyExpenseModel, { IMonthlyExpense } from "@/models/MonthlyExpense";
import mongoose, { Types } from "mongoose";
import type { IBlockDaily, IMixMaterial } from "@/models/BlockDaily";

type UserId = string | Types.ObjectId;

interface RecalcResult {
  totalBlocks: number;
  totalDailyBill: number;
  totalMixCost: number;
  totalWages: number;
  totalMonthly: number;
  costPerBlock: number;
  grandCostPerBlock: number;
}

function getUserFilter(userId: UserId): Record<string, unknown> {
  if (typeof userId === "string" && !mongoose.Types.ObjectId.isValid(userId)) {
    return { userId: userId };
  }
  const id = typeof userId === "string" ? new Types.ObjectId(userId) : userId;
  return {
    $or: [{ userId: id }, { userId: id.toString() }],
  };
}

export async function recalcMonthlyExpense(userId: UserId, month: string): Promise<RecalcResult> {
  const [y, m] = month.split("-").map((v) => Number(v));
  const startPK = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0) - 5 * 60 * 60 * 1000);
  const endPK = new Date(Date.UTC(y, m, 1, 0, 0, 0) - 5 * 60 * 60 * 1000);

  const userFilter = getUserFilter(userId);

  const dailies = await BlockDailyModel.find({
    ...userFilter,
    date: { $gte: startPK, $lt: endPK },
  }).lean<IBlockDaily[]>();

  const totalBlocks = dailies.reduce((s, d) => s + (d.blocksCount || 0), 0);
  const totalDailyBill = dailies.reduce((s, d) => s + (d.totalBill || 0), 0);
  const totalMixCost = dailies.reduce((s, d) => {
    const mix = (d.mixCost || 0) > 0 ? d.mixCost : d.mixMaterials?.reduce((a: number, mm: IMixMaterial) => a + (mm.amount || 0), 0) || 0;
    return s + mix;
  }, 0);
  const totalWages = dailies.reduce((s, d) => s + (d.dailyWages || 0), 0);

  const existing = await MonthlyExpenseModel.findOne({
    ...userFilter,
    month,
  }).lean<IMonthlyExpense>();

  const electricity = existing?.electricity ?? 0;
  const rent = existing?.rent ?? 0;
  const other = existing?.other ?? 0;

  const totalMonthly = electricity + rent + other;
  const costPerBlock = totalBlocks > 0 ? Number((totalMonthly / totalBlocks).toFixed(2)) : 0;
  const grandCostPerBlock = totalBlocks > 0 ? Number(((totalDailyBill + totalMonthly) / totalBlocks).toFixed(2)) : 0;

  const finalUserId = existing?.userId ?? userId;

  const updated = await MonthlyExpenseModel.findOneAndUpdate(
    { userId: finalUserId, month },
    {
      $set: {
        userId: finalUserId,
        month,
        totalBlocks,
        totalDailyBill,
        totalMixCost,
        totalMonthly,
        costPerBlock,
        grandCostPerBlock,
      },
      $setOnInsert: {
        electricity: 0,
        rent: 0,
        other: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean<IMonthlyExpense>();

  return {
    totalBlocks,
    totalDailyBill,
    totalMixCost,
    totalWages,
    totalMonthly: updated?.totalMonthly ?? totalMonthly,
    costPerBlock: updated?.costPerBlock ?? costPerBlock,
    grandCostPerBlock: updated?.grandCostPerBlock ?? grandCostPerBlock,
  };
}

export async function recalcDailiesAfterTrolleyClose(
  userId: UserId,
  trolleyEntryId: string,
  newRate: number
): Promise<void> {
  const dailies = await BlockDailyModel.find({
    ...getUserFilter(userId),
    "mixMaterials.trolleyEntryId": trolleyEntryId,
  });

  for (const daily of dailies) {
    let changed = false;
    daily.mixMaterials.forEach((mm) => {
      if (mm.trolleyEntryId === trolleyEntryId) {
        const newAmount = Math.round((mm.rairi || 0) * newRate);
        if (mm.amount !== newAmount) {
          mm.rate = newRate;
          mm.amount = newAmount;
          changed = true;
        }
      }
    });
    if (changed) {
      await daily.save();
    }
  }

  const months = [
    ...new Set(
      dailies.map((d) => {
        const dt = new Date(d.date);
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
      })
    ),
  ];

  for (const month of months) {
    await recalcMonthlyExpense(userId, month);
  }
}