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
  totalMixCost: number;
  costPerBlock: number;
  grandCostPerBlock: number;
}

const MonthlyExpenseSchema = new Schema<IMonthlyExpense>({
  month: { type: String, required: true, trim: true, index: true },
  userId: { type: Schema.Types.Mixed, required: true, index: true },
  electricity: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  rent: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  other: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalMonthly: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalBlocks: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalDailyBill: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  totalMixCost: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  costPerBlock: { type: Number, default: 0, min: 0 },
  grandCostPerBlock: { type: Number, default: 0, min: 0 },
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
  return { totalMonthly, costPerBlock, grandCostPerBlock };
}

// FIX 1: No `next` param in validate hook for Mongoose 7+
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
});

// FIX 2: Typed query hook - no `any`
MonthlyExpenseSchema.pre("findOneAndUpdate", function() {
  const update = this.getUpdate() as { $set?: Partial<IMonthlyExpense> } | null;
  if (!update) return;

  // Normalize to $set object
  const setObj = (update as { $set?: Partial<IMonthlyExpense> }).$set || (update as Partial<IMonthlyExpense>);

  const hasRelevant = 
    setObj.electricity !== undefined ||
    setObj.rent !== undefined ||
    setObj.other !== undefined ||
    setObj.totalBlocks !== undefined ||
    setObj.totalDailyBill !== undefined;

  if (!hasRelevant) return;

  const c = calcFields({
    electricity: setObj.electricity,
    rent: setObj.rent,
    other: setObj.other,
    totalBlocks: setObj.totalBlocks,
    totalDailyBill: setObj.totalDailyBill,
  });

  // Only update what was actually changing
  if (setObj.electricity !== undefined || setObj.rent !== undefined || setObj.other !== undefined) {
    setObj.totalMonthly = c.totalMonthly;
    setObj.costPerBlock = c.costPerBlock;
  }
  if (setObj.totalDailyBill !== undefined || setObj.totalBlocks !== undefined) {
    setObj.grandCostPerBlock = c.grandCostPerBlock;
    if (setObj.totalBlocks !== undefined && setObj.electricity === undefined) {
      // keep totalMonthly from existing doc, but ensure grandCost is fresh
      setObj.totalMonthly = setObj.totalMonthly ?? c.totalMonthly;
    }
  }

  this.setUpdate({ $set: setObj });
});

MonthlyExpenseSchema.index({ userId: 1, month: 1 }, { unique: true });
MonthlyExpenseSchema.index({ userId: 1, month: -1 });

const MonthlyExpenseModel =
  (mongoose.models.MonthlyExpense as mongoose.Model<IMonthlyExpense>) ||
  mongoose.model<IMonthlyExpense>("MonthlyExpense", MonthlyExpenseSchema);

export default MonthlyExpenseModel;