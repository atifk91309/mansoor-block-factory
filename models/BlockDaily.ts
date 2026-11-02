import mongoose, { Schema, Document, Types } from "mongoose";

export interface IBlockDaily extends Document {
  date: Date;
  cementBags: number;
  blocksMade: string; // ✅ STRING - Slim Block, Khatta Block, Shaga Block, Maneray Crush etc.
  blocksCount: number; // ✅ NEW - Qty 1500, 800 etc. - removable 1 logic
  dailyWages: number;
  ratePerBlock: number;
  blockType: string;
  userId: Types.ObjectId;
}

const BlockDailySchema = new Schema<IBlockDaily>({
  date: { type: Date, required: true, default: Date.now, index: true },
  cementBags: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  blocksMade: { type: String, required: true, trim: true, index: true }, // ✅ Changed Number -> String
  blocksCount: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) }, // ✅ NEW FIELD
  dailyWages: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  ratePerBlock: { type: Number, default: 3, min: 0, set: (v: number) => Math.round(v || 0) },
  blockType: { type: String, default: "6 inch", index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
}, { timestamps: true });

BlockDailySchema.pre("validate", function() {
  if (this.blocksCount && this.ratePerBlock) {
    this.dailyWages = Math.round(this.blocksCount * this.ratePerBlock);
  }
  if (!this.date) this.date = new Date();
});

BlockDailySchema.index({ userId: 1, date: -1 });
BlockDailySchema.index({ userId: 1, blocksMade: 1 });

export default mongoose.models.BlockDaily as mongoose.Model<IBlockDaily> || mongoose.model<IBlockDaily>("BlockDaily", BlockDailySchema);