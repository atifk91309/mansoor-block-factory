import mongoose, { Schema, Document, Types } from "mongoose";

export interface IWusoolEntry {
  _id?: Types.ObjectId;
  amount: number;
  date: Date;
  note?: string;
}

export interface ICustomer extends Document {
  name: string;
  normalizedName: string;
  phone: string;
  village: string;
  totalUdhar: number;
  totalBusiness: number;
  lastUdharDate: Date;
  saleIds: Types.ObjectId[];
  userId: Types.ObjectId;
  billsCount: number;
  idsGrouped?: Types.ObjectId[];
  isPaid: boolean;
  paidAmount: number;
  paidAt?: Date;
  lastWusoolDate?: Date;
  wusoolHistory: IWusoolEntry[];
  age?: number;
  customerType?: string;
  localId?: string;
  synced?: boolean;
}

const WusoolHistorySchema = new Schema<IWusoolEntry>(
  {
    amount: { type: Number, required: true, min: 0, set: (v:number)=> Math.round(v||0) },
    date: { type: Date, default: Date.now },
    note: { type: String, default: "", trim: true },
  },
  { _id: true, timestamps: false }
);

const CustomerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: "", trim: true },
    village: { type: String, default: "", trim: true },
    totalUdhar: { type: Number, default: 0, min: 0, set: (v:number)=> Math.round(v||0) },
    totalBusiness: { type: Number, default: 0, min: 0, set: (v:number)=> Math.round(v||0) },
    lastUdharDate: { type: Date, default: Date.now },
    saleIds: { type: [{ type: Schema.Types.ObjectId, ref: "Sale" }], default: [] },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    billsCount: { type: Number, default: 1, min: 1 },
    idsGrouped: { type: [Schema.Types.ObjectId], default: [] },
    isPaid: { type: Boolean, default: false },
    paidAmount: { type: Number, default: 0, min: 0, set: (v:number)=> Math.round(v||0) },
    paidAt: { type: Date },
    lastWusoolDate: { type: Date },
    wusoolHistory: { type: [WusoolHistorySchema], default: [] },
    age: { type: Number, min: 0, max: 120 },
    customerType: { type: String, default: "regular", enum: ["customer", "walk-in", "regular"] },
    localId: { type: String, sparse: true },
    synced: { type: Boolean, default: true },
  },
  { timestamps: true }
);

CustomerSchema.pre("validate", function () {
  if (this.name) {
    this.normalizedName = this.name.trim().toLowerCase();
  }
  this.totalUdhar = Math.round(this.totalUdhar||0);
  this.totalBusiness = Math.round(this.totalBusiness||0);
  this.paidAmount = Math.round(this.paidAmount||0);
});

CustomerSchema.index({ userId: 1, normalizedName: 1 }, { unique: true, partialFilterExpression: { isPaid: false } });
CustomerSchema.index({ userId: 1, createdAt: -1 });
CustomerSchema.index({ userId: 1, isPaid: 1 });
CustomerSchema.index({ userId: 1, village: 1 });
CustomerSchema.index({ userId: 1, localId: 1 }, { sparse: true, unique: true });
CustomerSchema.index({ localId: 1 }, { sparse: true });

export default mongoose.models.Customer || mongoose.model<ICustomer>("Customer", CustomerSchema);