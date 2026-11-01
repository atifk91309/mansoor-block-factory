import mongoose, { Schema, Document, Types } from "mongoose";

export type PaymentType = "cash" | "udhar" | "jazzcash" | "easypaisa" | "bank";
export type SaleCategory = "khaka" | "crush" | "bajri" | "rait" | "block" | "cement" | "other";

export interface ISaleItem {
  productId?: Types.ObjectId;
  productName: string; // "6 inch Block" or "1 Trolly Crush"
  category: SaleCategory;
  quantity: number; // 500 blocks, 1 trolly
  unit: string; // piece, trolly, bag
  buyPrice: number;
  sellPrice: number;
}

export interface ISale extends Document {
  invoiceNo: string;
  date: Date; // ✅ Purchase date client selects
  items: ISaleItem[];
  totalQuantity: number;
  totalBuy: number;
  totalSell: number;
  totalProfit: number;
  paymentType: PaymentType;
  customerId?: Types.ObjectId;
  customerName: string;
  customerPhone: string;
  village: string;
  isUdhar: boolean;
  paidAmount: number;
  remainingUdhar: number;
  userId: Types.ObjectId;
  localId?: string;
  synced?: boolean;
}

const SaleItemSchema = new Schema<ISaleItem>({
  productId: { type: Schema.Types.ObjectId, ref: "BlockProduct" },
  productName: { type: String, required: true, trim: true },
  category: { type: String, enum: ["khaka","crush","bajri","rait","block","cement","other"], required: true, index: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, default: "piece" },
  buyPrice: { type: Number, default: 0, min: 0, set: (v:number)=> Math.round(v||0) },
  sellPrice: { type: Number, required: true, min: 0, set: (v:number)=> Math.round(v||0) },
}, { _id: false });

const SaleSchema = new Schema<ISale>({
  invoiceNo: { type: String, required: true, index: true },
  date: { type: Date, required: true, default: Date.now, index: true }, // ✅ Client can pick old date
  items: { type: [SaleItemSchema], required: true },
  totalQuantity: { type: Number, default: 0 },
  totalBuy: { type: Number, default: 0, set: (v:number)=> Math.round(v||0) },
  totalSell: { type: Number, required: true, set: (v:number)=> Math.round(v||0) },
  totalProfit: { type: Number, default: 0, set: (v:number)=> Math.round(v||0) },
  paymentType: { type: String, enum: ["cash","udhar","jazzcash","easypaisa","bank"], default: "cash", index: true },
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
  customerName: { type: String, default: "Walk-in Customer", trim: true, index: true },
  customerPhone: { type: String, default: "" },
  village: { type: String, default: "", trim: true },
  isUdhar: { type: Boolean, default: false, index: true },
  paidAmount: { type: Number, default: 0, min: 0, set: (v:number)=> Math.round(v||0) },
  remainingUdhar: { type: Number, default: 0, min: 0, set: (v:number)=> Math.round(v||0) },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  localId: { type: String, sparse: true, index: true },
  synced: { type: Boolean, default: true },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// FAST INDEXES — same style as your Product & Customer
SaleSchema.index({ userId: 1, date: -1 }); // fast daily history
SaleSchema.index({ userId: 1, createdAt: -1 });
SaleSchema.index({ userId: 1, isUdhar: 1, date: -1 }); // fast udhar list
SaleSchema.index({ userId: 1, customerName: 1 });
SaleSchema.index({ userId: 1, invoiceNo: 1 }, { unique: true });
SaleSchema.index({ userId: 1, "items.category": 1 }); // fast filter: block, rait, crush, khaka
SaleSchema.index({ localId: 1 }, { sparse: true });

SaleSchema.pre("validate", function(){
  this.totalQuantity = this.items.reduce((sum, i) => sum + (i.quantity || 0), 0);
  this.totalBuy = Math.round(this.items.reduce((sum, i) => sum + (i.buyPrice * i.quantity), 0));
  this.totalSell = Math.round(this.items.reduce((sum, i) => sum + (i.sellPrice * i.quantity), 0));
  this.totalProfit = Math.round(this.totalSell - this.totalBuy);
  this.isUdhar = this.paymentType === "udhar";
  this.remainingUdhar = Math.round(this.totalSell - (this.paidAmount || 0));
});

export default mongoose.models.Sale || mongoose.model<ISale>("Sale", SaleSchema);