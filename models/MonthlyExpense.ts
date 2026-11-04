import mongoose, { Schema, Document, Types, Query } from "mongoose";

export interface IMonthlyExpense extends Document {
  month: string;
  batchId?: string; // OPTIONAL now
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
  totalLabourCost: number;
  costPerBlock: number;
  grandCostPerBlock: number;
  trueCostPerBlock: number;
}

const MonthlyExpenseSchema = new Schema<IMonthlyExpense>({
  month: { type: String, required: true, trim: true, index: true },
  batchId: { type: String, required: false, trim: true }, // OPTIONAL - No default BATCH-1
  userId: { type: Schema.Types.Mixed, required: true, index: true },
  electricity: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  rent: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  other: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalMonthly: { type: Number, default: 0, min: 0 },
  totalBlocks: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalDailyBill: { type: Number, default: 0, min: 0 },
  totalMixCost: { type: Number, default: 0, min: 0 },
  totalCementCost: { type: Number, default: 0, min: 0 },
  totalCementBags: { type: Number, default: 0, min: 0 },
  totalTrolleyCost: { type: Number, default: 0, min: 0 },
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
  return { totalMonthly, costPerBlock, grandCostPerBlock, trueCostPerBlock: grandCostPerBlock };
}

MonthlyExpenseSchema.pre("validate", function() {
  const c = calcFields({
    electricity: this.electricity,
    rent: this.rent,
    other: this.other,
    totalBlocks: this.totalBlocks,
    totalDailyBill: this.totalDailyBill,
  });
  this.totalMonthly = c.totalMonthly;
  this.costPerBlock = c.costPerBlock;
  this.grandCostPerBlock = c.grandCostPerBlock;
  this.trueCostPerBlock = c.trueCostPerBlock;
  if (this.totalCementCost || this.totalTrolleyCost) {
    this.totalMixCost = (this.totalCementCost || 0) + (this.totalTrolleyCost || 0);
  }
});

MonthlyExpenseSchema.pre("findOneAndUpdate", function(this: Query<unknown, IMonthlyExpense>) {
  const rawUpdate = this.getUpdate();
  if (!rawUpdate) return;
  const updateObj = rawUpdate as Record<string, unknown>;
  const setObj = (updateObj.$set as Partial<IMonthlyExpense> | undefined) || (updateObj as unknown as Partial<IMonthlyExpense>);
  const hasRelevant =
    setObj.electricity !== undefined ||
    setObj.rent !== undefined ||
    setObj.other !== undefined ||
    setObj.totalBlocks !== undefined ||
    setObj.totalDailyBill !== undefined ||
    setObj.totalCementCost !== undefined ||
    setObj.totalTrolleyCost !== undefined ||
    setObj.totalLabourCost !== undefined;
  if (!hasRelevant) return;
  if (setObj.totalCementCost !== undefined || setObj.totalTrolleyCost !== undefined) {
    setObj.totalMixCost = (setObj.totalCementCost || 0) + (setObj.totalTrolleyCost || 0);
  }
  const c = calcFields({
    electricity: setObj.electricity,
    rent: setObj.rent,
    other: setObj.other,
    totalBlocks: setObj.totalBlocks,
    totalDailyBill: setObj.totalDailyBill,
  });
  setObj.totalMonthly = c.totalMonthly;
  setObj.costPerBlock = c.costPerBlock;
  setObj.grandCostPerBlock = c.grandCostPerBlock;
  setObj.trueCostPerBlock = c.trueCostPerBlock;
  this.setUpdate({ $set: setObj });
});

MonthlyExpenseSchema.index({ userId: 1, month: 1 }, { unique: true });
MonthlyExpenseSchema.index({ userId: 1, month: -1 });

const MonthlyExpenseModel =
  (mongoose.models.MonthlyExpense as mongoose.Model<IMonthlyExpense>) ||
  mongoose.model<IMonthlyExpense>("MonthlyExpense", MonthlyExpenseSchema);

export default MonthlyExpenseModel;