import BlockDailyModel from "@/models/BlockDaily";
import MonthlyExpenseModel, { IMonthlyExpense } from "@/models/MonthlyExpense";
import mongoose, { Types } from "mongoose";
import type { IBlockDaily, IMixMaterial } from "@/models/BlockDaily";

type UserId = string | Types.ObjectId;

interface RecalcResult {
  totalBlocks: number;
  totalDailyBill: number;
  totalMixCost: number;
  totalCementCost: number;
  totalCementBags: number;
  totalTrolleyCost: number;
  totalLabourCost: number;
  totalWages: number;
  totalMonthly: number;
  costPerBlock: number;
  grandCostPerBlock: number;
  trueCostPerBlock: number;
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

export async function recalcMonthlyExpense(
  userId: UserId,
  month: string, 
): Promise<RecalcResult> {
  const [y, m] = month.split("-").map((v) => Number(v));
  const startPK = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0) - 5 * 60 * 60 * 1000);
  const endPK = new Date(Date.UTC(y, m, 1, 0, 0, 0) - 5 * 60 * 60 * 1000);

  const userFilter = getUserFilter(userId);

  // NO batchId filter - show all data whether batch exists or not
  const dailies = await BlockDailyModel.find({
    ...userFilter,
    date: { $gte: startPK, $lt: endPK },
  }).lean<IBlockDaily[]>();

  const totalBlocks = dailies.reduce((s, d) => s + (d.blocksCount || 0), 0);
  const totalDailyBill = dailies.reduce((s, d) => s + (d.totalBill || 0), 0);
  
  const totalCementCost = dailies.reduce((s, d) => {
    const doc = d as IBlockDaily & { cementCost?: number };
    return s + (doc.cementCost || 0);
  }, 0);
  
  const totalCementBags = dailies.reduce((s, d) => {
    const doc = d as IBlockDaily & { cementBags?: number };
    return s + (doc.cementBags || 0);
  }, 0);
  
  const totalTrolleyCost = dailies.reduce((s, d) => {
    const doc = d as IBlockDaily & { trolleyMixCost?: number };
    return s + (doc.trolleyMixCost || d.mixCost || 0);
  }, 0);
  
  const totalLabourCost = dailies.reduce((s, d) => {
    const doc = d as IBlockDaily & { labourCost?: number };
    return s + (doc.labourCost || d.dailyWages || 0);
  }, 0);

  const totalMixCost = totalCementCost + totalTrolleyCost;
  const totalWages = totalLabourCost;

  const existing = await MonthlyExpenseModel.findOne({
    userId: typeof userId === "string" ? userId : userId.toString(),
    month,
  }).lean<IMonthlyExpense>();

  const existing2 = existing || await MonthlyExpenseModel.findOne({
    ...userFilter,
    month,
  }).lean<IMonthlyExpense>();

  const electricity = existing2?.electricity ?? 0;
  const rent = existing2?.rent ?? 0;
  const other = existing2?.other ?? 0;

  const totalMonthly = electricity + rent + other;
  const costPerBlock = totalBlocks > 0 ? Number((totalMonthly / totalBlocks).toFixed(2)) : 0;
  const grandCostPerBlock = totalBlocks > 0 ? Number(((totalDailyBill + totalMonthly) / totalBlocks).toFixed(2)) : 0;

  const finalUserId = existing2?.userId ?? userId;

  const updated = await MonthlyExpenseModel.findOneAndUpdate(
    { userId: finalUserId, month },
    {
      $set: {
        userId: finalUserId,
        month,
        totalBlocks,
        totalDailyBill,
        totalMixCost,
        totalCementCost,
        totalCementBags,
        totalTrolleyCost,
        totalLabourCost,
        totalMonthly,
        costPerBlock,
        grandCostPerBlock,
        trueCostPerBlock: grandCostPerBlock,
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
    totalCementCost,
    totalCementBags,
    totalTrolleyCost,
    totalLabourCost,
    totalWages,
    totalMonthly: updated?.totalMonthly ?? totalMonthly,
    costPerBlock: updated?.costPerBlock ?? costPerBlock,
    grandCostPerBlock: updated?.grandCostPerBlock ?? grandCostPerBlock,
    trueCostPerBlock: updated?.grandCostPerBlock ?? grandCostPerBlock,
  };
}

export async function recalcDailiesAfterTrolleyClose(
  userId: UserId,
  trolleyEntryId: string,
  newRate: number,
  
): Promise<void> {
  const dailies = await BlockDailyModel.find({
    ...getUserFilter(userId),
    "mixMaterials.trolleyEntryId": trolleyEntryId,
  });

  for (const daily of dailies) {
    let changed = false;
    daily.mixMaterials.forEach((mm: IMixMaterial) => {
      if (mm.trolleyEntryId === trolleyEntryId) {
        const isEstimatedRate = mm.rate === 0 || mm.amount === 0;
        if (isEstimatedRate) {
          const newAmount = Math.round((mm.rairi || 0) * newRate);
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

export async function closeBatchAndStartNew(
  userId: UserId,
  oldBatchId: string,
  newBatchId: string
): Promise<void> {
  console.log(`Batch ${oldBatchId} closed, new batch ${newBatchId} started for user ${userId} - No Batch logic now, all data shown`);
}