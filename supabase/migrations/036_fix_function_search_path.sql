CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_room_status_history()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO room_status_history (
      room_id, tenant_id, from_status, to_status, changed_by, change_source
    ) VALUES (
      NEW.room_id, NEW.tenant_id, OLD.status, NEW.status, NEW.assigned_to, 'app'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_inspection_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.overall_result IN ('passed', 'conditional') THEN
    UPDATE room_status SET
      status = 'INSPECTED', last_inspected_at = NOW(),
      last_inspected_by = NEW.inspected_by, updated_at = NOW()
    WHERE room_id = NEW.room_id;
  ELSIF NEW.overall_result = 'failed' THEN
    UPDATE room_status SET status = 'DIRTY', updated_at = NOW()
    WHERE room_id = NEW.room_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_credits_used(p_hotel_id uuid, p_credits numeric)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $function$
  UPDATE credit_ledger
  SET credits_used = credits_used + p_credits
  WHERE tenant_id = p_hotel_id
    AND period_start <= CURRENT_DATE
    AND period_end   >= CURRENT_DATE
    AND is_finalized = FALSE;
$function$;

CREATE OR REPLACE FUNCTION public.match_sop_chunks(
  query_embedding vector,
  match_hotel_id uuid,
  match_threshold double precision DEFAULT 0.75,
  match_count integer DEFAULT 5
)
RETURNS TABLE(id uuid, content text, similarity double precision, metadata jsonb, document_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $function$
  SELECT sc.id, sc.content,
    1 - (sc.embedding <=> query_embedding) AS similarity,
    sc.metadata, sc.document_id
  FROM sop_chunks sc
  WHERE sc.tenant_id = match_hotel_id
    AND sc.embedding IS NOT NULL
    AND 1 - (sc.embedding <=> query_embedding) > match_threshold
  ORDER BY sc.embedding <=> query_embedding
  LIMIT match_count;
$function$;
