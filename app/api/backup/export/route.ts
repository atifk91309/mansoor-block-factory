import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import BlockProduct from "@/models/BlockProduct";
import Sale from "@/models/Sale";
import Customer from "@/models/Customer";
import BlockDaily from "@/models/BlockDaily";

export async function GET() {
  await dbConnect();
  const [blockProducts, sales, customers, blockDaily] = await Promise.all([
    BlockProduct.find().lean(),
    Sale.find().lean(),
    Customer.find().lean(),
    BlockDaily.find().lean(),
  ]);
  return NextResponse.json({ blockProducts, sales, customers, blockDaily });
}