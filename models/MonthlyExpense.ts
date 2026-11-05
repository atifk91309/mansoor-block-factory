import mongoose, { Schema, Document, Types, Query, UpdateQuery } from "mongoose";

export interface IMonthlyExpense extends Document {
  month: string;
  batchId?: string;
  userId: Types.ObjectId | string;
  electricity: number;
  rent: number;
  other: number;
  totalMonthly: number;
  totalBlocks: number;
  totalDailyBill: number;
  totalMixCost: number;
  totalCementCost: number;
  totalCementBags: number;
  totalTrolleyCost: number;
  totalRairiUsed?: number;
  totalLabourCost: number;
  costPerBlock: number;
  grandCostPerBlock: number;
  trueCostPerBlock: number;
}

const MonthlyExpenseSchema = new Schema<IMonthlyExpense>({
  month: { type: String, required: true, trim: true, index: true },
  batchId: { type: String, required: false, trim: true },
  userId: { type: Schema.Types.Mixed, required: true, index: true },
  electricity: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  rent: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  other: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalMonthly: { type: Number, default: 0, min: 0 },
  totalBlocks: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalDailyBill: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalMixCost: { type: Number, default: 0, min: 0 },
  totalCementCost: { type: Number, default: 0, min: 0 },
  totalCementBags: { type: Number, default: 0, min: 0 },
  totalTrolleyCost: { type: Number, default: 0, min: 0 },
  totalRairiUsed: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalLabourCost: { type: Number, default: 0, min: 0 },
  costPerBlock: { type: Number, default: 0, min: 0 },
  grandCostPerBlock: { type: Number, default: 0, min: 0 },
  trueCostPerBlock: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

type CalcInput = {
  electricity?: number;
  rent?: number;
  other?: number;
  totalBlocks?: number;
  totalDailyBill?: number;
  totalCementCost?: number;
  totalTrolleyCost?: number;
};

function calcFields(doc: CalcInput) {
  const electricity = Math.round(doc.electricity || 0);
  const rent = Math.round(doc.rent || 0);
  const other = Math.round(doc.other || 0);
  const totalBlocks = Math.round(doc.totalBlocks || 0);
  const totalDailyBill = Math.round(doc.totalDailyBill || 0);
  const totalMonthly = electricity + rent + other;
  const costPerBlock = totalBlocks > 0 ? Number((totalMonthly / totalBlocks).toFixed(2)) : 0;
  const grandCostPerBlock = totalBlocks > 0 ? Number(((totalDailyBill + totalMonthly) / totalBlocks).toFixed(2)) : 0;
  const totalMixCost = Math.round((doc.totalCementCost || 0) + (doc.totalTrolleyCost || 0));
  return { totalMonthly, costPerBlock, grandCostPerBlock, trueCostPerBlock: grandCostPerBlock, totalMixCost };
}

MonthlyExpenseSchema.pre("validate", function() {
  const c = calcFields({
    electricity: this.electricity,
    rent: this.rent,
    other: this.other,
    totalBlocks: this.totalBlocks,
    totalDailyBill: this.totalDailyBill,
    totalCementCost: this.totalCementCost,
    totalTrolleyCost: this.totalTrolleyCost,
  });
  this.totalMonthly = c.totalMonthly;
  this.costPerBlock = c.costPerBlock;
  this.grandCostPerBlock = c.grandCostPerBlock;
  this.trueCostPerBlock = c.trueCostPerBlock;
  this.totalMixCost = c.totalMixCost;
});

MonthlyExpenseSchema.pre("findOneAndUpdate", function(this: Query<IMonthlyExpense, IMonthlyExpense>) {
  const rawUpdate = this.getUpdate() as UpdateQuery<IMonthlyExpense> | null;
  if (!rawUpdate) return;

  const isSetUpdate = (u: UpdateQuery<IMonthlyExpense>): u is UpdateQuery<IMonthlyExpense> & { $set: Partial<IMonthlyExpense> } => {
    return typeof u === "object" && u !== null && "$set" in u;
  };

  const setObj: Partial<IMonthlyExpense> = isSetUpdate(rawUpdate) 
    ? { ...rawUpdate.$set } 
    : { ...(rawUpdate as Partial<IMonthlyExpense>) };

  const hasRelevant =
    setObj.electricity !== undefined ||
    setObj.rent !== undefined ||
    setObj.other !== undefined ||
    setObj.totalBlocks !== undefined ||
    setObj.totalDailyBill !== undefined ||
    setObj.totalCementCost !== undefined ||
    setObj.totalTrolleyCost !== undefined ||
    setObj.totalRairiUsed !== undefined;

  if (!hasRelevant) return;

  const c = calcFields({
    electricity: setObj.electricity,
    rent: setObj.rent,
    other: setObj.other,
    totalBlocks: setObj.totalBlocks,
    totalDailyBill: setObj.totalDailyBill,
    totalCementCost: setObj.totalCementCost,
    totalTrolleyCost: setObj.totalTrolleyCost,
  });

  setObj.totalMonthly = c.totalMonthly;
  setObj.costPerBlock = c.costPerBlock;
  setObj.grandCostPerBlock = c.grandCostPerBlock;
  setObj.trueCostPerBlock = c.trueCostPerBlock;
  setObj.totalMixCost = c.totalMixCost;

  this.setUpdate({ $set: setObj });
});

MonthlyExpenseSchema.index({ userId: 1, month: 1 }, { unique: true });
MonthlyExpenseSchema.index({ userId: 1, month: -1 });

const MonthlyExpenseModel =
  (mongoose.models.MonthlyExpense as mongoose.Model<IMonthlyExpense>) ||
  mongoose.model<IMonthlyExpense>("MonthlyExpense", MonthlyExpenseSchema);

export default MonthlyExpenseModel;