import mongoose, { Schema, Document, Types } from "mongoose";

export interface IBill {
  label: string;
  amount: number;
}

export interface IMixMaterial {
  label: string;
  qty: string; // "7 Hath Rairi", "5 Hath", "1,2,3" - STRING
}

export interface IBlockDaily extends Document {
  date: Date;
  cementBags: number;
  blocksMade: string;
  blocksCount: number;
  dailyWages: number;
  ratePerBlock: number;
  blockType: string;
  userId: Types.ObjectId;
  bills: IBill[];
  mixMaterials: IMixMaterial[];
  totalBill: number;
  costPerBlock: number;
  isMonthlyElectricity: boolean;
}

const BillSchema = new Schema<IBill>({
  label: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
}, { _id: false });

const MixMaterialSchema = new Schema<IMixMaterial>({
  label: { type: String, required: true, trim: true },
  qty: { type: String, required: true, trim: true, default: "" },
}, { _id: false });

const BlockDailySchema = new Schema<IBlockDaily>({
  date: { type: Date, required: true, default: Date.now, index: true },
  cementBags: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  blocksMade: { type: String, required: true, trim: true, index: true },
  blocksCount: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  dailyWages: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  ratePerBlock: { type: Number, default: 3, min: 0, set: (v: number) => Math.round(v || 0) },
  blockType: { type: String, default: "6 inch", index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

  bills: { type: [BillSchema], default: [] },
  mixMaterials: { type: [MixMaterialSchema], default: [] },
  totalBill: { type: Number, default: 0, min: 0 },
  costPerBlock: { type: Number, default: 0, min: 0 },
  isMonthlyElectricity: { type: Boolean, default: false },

}, { timestamps: true });

BlockDailySchema.pre("validate", function() {
  if (!this.date) {
    this.date = new Date();
  }
  
  if (this.blocksCount && this.ratePerBlock) {
    this.dailyWages = Math.round(this.blocksCount * this.ratePerBlock);
  }

  const extraBills = this.bills.reduce((sum, b) => {
    if (b.label.toLowerCase().includes("labour")) {
      return sum;
    }
    return sum + (b.amount || 0);
  }, 0);

  this.totalBill = (this.dailyWages || 0) + extraBills;
  
  if (this.blocksCount > 0) {
    this.costPerBlock = Math.round((this.totalBill / this.blocksCount) * 10) / 10;
  }

});

BlockDailySchema.index({ userId: 1, date: -1 });
BlockDailySchema.index({ userId: 1, blocksMade: 1 });

const BlockDailyModel = mongoose.models.BlockDaily as mongoose.Model<IBlockDaily> || mongoose.model<IBlockDaily>("BlockDaily", BlockDailySchema);

export default BlockDailyModel;