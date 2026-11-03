import mongoose, { Schema, Document, Types } from "mongoose";

export interface IMonthlyExpense extends Document {
  month: string;
  userId: Types.ObjectId | string;
  electricity: number;
  rent: number;
  other: number;
  totalMonthly: number;
  totalBlocks: number;
  totalDailyBill: number;
  costPerBlock: number;
  grandCostPerBlock: number;
}

const MonthlyExpenseSchema = new Schema<IMonthlyExpense>({
  month: { type: String, required: true, trim: true, index: true },
  // FIX: allow String for offline_user, not only ObjectId
  userId: { type: Schema.Types.Mixed, required: true, index: true },
  electricity: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  rent: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  other: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalMonthly: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalBlocks: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalDailyBill: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  costPerBlock: { type: Number, default: 0, min: 0 },
  grandCostPerBlock: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

function calcFields(doc: Partial<IMonthlyExpense>) {
  const electricity = Math.round(doc.electricity || 0);
  const rent = Math.round(doc.rent || 0);
  const other = Math.round(doc.other || 0);
  const totalBlocks = Math.round(doc.totalBlocks || 0);
  const totalDailyBill = Math.round(doc.totalDailyBill || 0);
  const totalMonthly = electricity + rent + other;
  const costPerBlock = totalBlocks > 0 ? Number((totalMonthly / totalBlocks).toFixed(2)) : 0;
  const grandCostPerBlock = totalBlocks > 0 ? Number(((totalDailyBill + totalMonthly) / totalBlocks).toFixed(2)) : 0;
  return { totalMonthly, costPerBlock, grandCostPerBlock };
}

MonthlyExpenseSchema.pre("validate", function() {
  const c = calcFields(this);
  this.totalMonthly = c.totalMonthly;
  this.costPerBlock = c.costPerBlock;
  this.grandCostPerBlock = c.grandCostPerBlock;
});

// FIX: this hook runs for findOneAndUpdate upsert - your screenshot bug
MonthlyExpenseSchema.pre("findOneAndUpdate", function() {
  const update = this.getUpdate() as Record<string, unknown>;
  if (!update) return;
  // Handle both $set and direct set
  const set = (update.$set as Partial<IMonthlyExpense>) || update as Partial<IMonthlyExpense>;
  const c = calcFields(set);
  set.totalMonthly = c.totalMonthly;
  set.costPerBlock = c.costPerBlock;
  set.grandCostPerBlock = c.grandCostPerBlock;
  if (update.$set) {
    update.$set = set;
  } else {
    Object.assign(update, set);
  }
});

MonthlyExpenseSchema.index({ userId: 1, month: 1 }, { unique: true });
MonthlyExpenseSchema.index({ userId: 1, month: -1 });

const MonthlyExpenseModel = mongoose.models.MonthlyExpense as mongoose.Model<IMonthlyExpense> || mongoose.model<IMonthlyExpense>("MonthlyExpense", MonthlyExpenseSchema);

export default MonthlyExpenseModel;