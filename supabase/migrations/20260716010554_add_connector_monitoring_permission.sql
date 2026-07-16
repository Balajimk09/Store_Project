-- Connector monitoring is visible to authorized staff, but this migration does not grant it to any role or user.
do $$
declare
  v_group_id uuid;
begin
  if to_regclass('public.platform_permission_groups') is not null then
    select id
    into v_group_id
    from public.platform_permission_groups
    where code = 'connectors' or name = 'Connectors'
    order by sort_order, created_at
    limit 1;

    if v_group_id is null then
      insert into public.platform_permission_groups (
        name,
        code,
        description,
        sort_order,
        is_active
      )
      values (
        'Connectors',
        'connectors',
        'Connector health and synchronization monitoring permissions.',
        90,
        true
      )
      returning id into v_group_id;
    else
      update public.platform_permission_groups
      set name = 'Connectors',
          description = 'Connector health and synchronization monitoring permissions.',
          is_active = true,
          updated_at = now()
      where id = v_group_id;
    end if;
  end if;

  if to_regclass('public.platform_permissions') is not null then
    update public.platform_permissions
    set label = 'View Connectors',
        group_id = v_group_id,
        group_name = 'Connectors',
        module_key = 'connectors',
        description = 'View connector health, heartbeat, synchronization, and error status.',
        is_system_permission = true,
        is_dangerous = false,
        is_active = true,
        sort_order = 10,
        updated_at = now()
    where permission_key = 'connectors.view';

    if not found then
      insert into public.platform_permissions (
        permission_key,
        label,
        group_id,
        group_name,
        module_key,
        description,
        is_system_permission,
        is_dangerous,
        is_active,
        sort_order
      )
      values (
        'connectors.view',
        'View Connectors',
        v_group_id,
        'Connectors',
        'connectors',
        'View connector health, heartbeat, synchronization, and error status.',
        true,
        false,
        true,
        10
      );
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
