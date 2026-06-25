import { NextRequest } from 'next/server';
import { configs, createRow, listRows } from '../_lib';

export async function GET(request: NextRequest) {
  return listRows(request, configs.announcements);
}

export async function POST(request: NextRequest) {
  return createRow(request, configs.announcements);
}
