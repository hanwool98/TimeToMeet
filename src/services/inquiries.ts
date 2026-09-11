import { supabase } from '../lib/supabase';
import { getAdminSession } from './adminAuth';
import { getAppSession } from './appAuth';

// 마이페이지 "문의하기" -> 실제 고객 문의 게시판. 비밀글 접근 제어는
// 프론트가 아니라 DB의 SECURITY DEFINER RPC 안에서 판단하므로(마이그레이션
// 202609140000_inquiries_board.sql 참고), 여기서는 세션 토큰을 그대로
// 넘기고 서버가 내려준 결과만 그대로 보여준다.
export type InquiryStatus = 'pending' | 'answered';

export interface InquiryListItem {
  id: string;
  title: string;
  createdAt: string;
  status: InquiryStatus;
  isPrivate: boolean;
  isLocked: boolean;
  isMine: boolean;
}

export interface InquiryDetail {
  id: string;
  isLocked: boolean;
  isPrivate?: boolean;
  isMine?: boolean;
  title?: string;
  content?: string;
  status?: InquiryStatus;
  adminReply?: string | null;
  repliedAt?: string | null;
  createdAt?: string;
}

export interface AdminInquiryListItem {
  id: string;
  authorLabel: string;
  title: string;
  isPrivate: boolean;
  createdAt: string;
  status: InquiryStatus;
}

export interface AdminInquiryDetail {
  id: string;
  authorLabel: string;
  title: string;
  content: string;
  isPrivate: boolean;
  status: InquiryStatus;
  adminReply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

// 로그인 없이도 전체 문의 게시판은 열람할 수 있어야 하므로(공개 게시판),
// 세션이 없으면 빈 문자열을 넘긴다 - RPC는 빈/무효 토큰을 "익명"으로
// 취급해 비밀글을 전부 잠긴 상태로만 보여준다.
function currentSessionToken(): string {
  return getAppSession()?.token ?? '';
}

export async function fetchInquiries(search?: string): Promise<InquiryListItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_inquiries_for_session', {
    search_value: search?.trim() || null,
    session_token: currentSessionToken(),
  });
  if (error) throw new Error(error.message || '문의 목록을 불러오지 못했습니다.');
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    createdAt: row.created_at as string,
    id: row.id as string,
    isLocked: Boolean(row.is_locked),
    isMine: Boolean(row.is_mine),
    isPrivate: Boolean(row.is_private),
    status: row.status as InquiryStatus,
    title: row.title as string,
  }));
}

export async function fetchInquiryDetail(inquiryId: string): Promise<InquiryDetail | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_inquiry_detail_for_session', {
    inquiry_id_value: inquiryId,
    session_token: currentSessionToken(),
  });
  if (error) throw new Error(error.message || '문의를 불러오지 못했습니다.');
  return (data as InquiryDetail | null) ?? null;
}

export async function createInquiry(title: string, content: string, isPrivate: boolean): Promise<string> {
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.');
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인이 필요합니다.');

  const { data, error } = await supabase.rpc('create_inquiry_for_session', {
    content_value: content,
    is_private_value: isPrivate,
    session_token: session.token,
    title_value: title,
  });
  if (error) throw new Error(error.message || '문의 등록에 실패했습니다.');
  return data as string;
}

// ── 관리자: 문의 관리 ────────────────────────────────────────────
export async function fetchAdminInquiries(search?: string): Promise<AdminInquiryListItem[]> {
  if (!supabase) return [];
  const session = getAdminSession();
  if (!session?.token) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('list_inquiries_for_admin', {
    search_value: search?.trim() || null,
    session_token: session.token,
  });
  if (error) throw new Error(error.message || '문의 목록을 불러오지 못했습니다.');
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    authorLabel: row.author_label as string,
    createdAt: row.created_at as string,
    id: row.id as string,
    isPrivate: Boolean(row.is_private),
    status: row.status as InquiryStatus,
    title: row.title as string,
  }));
}

export async function fetchAdminInquiryDetail(inquiryId: string): Promise<AdminInquiryDetail | null> {
  if (!supabase) return null;
  const session = getAdminSession();
  if (!session?.token) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_inquiry_detail_for_admin', {
    inquiry_id_value: inquiryId,
    session_token: session.token,
  });
  if (error) throw new Error(error.message || '문의를 불러오지 못했습니다.');
  return (data as AdminInquiryDetail | null) ?? null;
}

export async function submitAdminInquiryReply(inquiryId: string, reply: string): Promise<void> {
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.');
  const session = getAdminSession();
  if (!session?.token) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('admin_reply_to_inquiry', {
    inquiry_id_value: inquiryId,
    reply_value: reply,
    session_token: session.token,
  });
  if (error) throw new Error(error.message || '답변 저장에 실패했습니다.');
}
