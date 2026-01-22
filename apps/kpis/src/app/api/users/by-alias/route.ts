import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const alias = searchParams.get('alias');

    if (!alias) {
      return NextResponse.json(
        { error: 'Alias parameter is required' },
        { status: 400 }
      );
    }

    const supabase = await supabaseServer();
    
    console.log('Looking for user with alias:', alias);
    
    // Get user profile with department information
    const { data: profile, error } = await supabase
      .from('profiles')
      .select(`
        id,
        full_name,
        job_title,
        department_id,
        invoice_approval_alias,
        departments(
          department_id,
          department_name,
          odoo_group_id
        )
      `)
      .ilike('invoice_approval_alias', alias)
      .single();

    if (error) {
      console.error('Error fetching user by alias:', error);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (!profile) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      user: {
        id: profile.id,
        full_name: profile.full_name,
        job_title: profile.job_title,
        department_id: profile.departments?.odoo_group_id,
        invoice_approval_alias: profile.invoice_approval_alias,
        department_name: profile.departments?.department_name
      }
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
