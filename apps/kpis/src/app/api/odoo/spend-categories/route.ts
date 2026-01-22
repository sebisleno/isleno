import { NextRequest, NextResponse } from 'next/server';
import { getSpendCategories } from '@/lib/odoo/services';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    const categories = await getSpendCategories();
    return NextResponse.json(categories);
  } catch (error: any) {
    console.error("Failed to fetch spend categories:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
