import { NextRequest } from 'next/server';
import { configs, deleteRow, RouteContext, updateRow } from '../../_lib';

export async function PATCH(request: NextRequest, context: RouteContext) {
  return updateRow(request, context, configs.posTypes);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return deleteRow(request, context, configs.posTypes);
}
