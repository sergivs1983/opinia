/**
 * Wave 2 write-family gate contract tests
 * Run: npx tsx src/__tests__/gate-wave2-writes-family.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass++;
  else fail++;
}

function includes(label: string, haystack: string, needle: string) {
  assert(label, haystack.includes(needle));
}

function ordered(label: string, haystack: string, before: string, after: string) {
  const beforeIdx = haystack.indexOf(before);
  const afterIdx = haystack.indexOf(after);
  assert(label, beforeIdx >= 0 && afterIdx >= 0 && beforeIdx < afterIdx);
}

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

function run() {
  const adminBusinessMemberships = read('src/app/api/admin/business-memberships/route.ts');
  includes('admin/business-memberships PATCH: uses biz gate', adminBusinessMemberships, 'requireBizAccessPatternB(request, scopedBizId');
  includes('admin/business-memberships PATCH: RBAC from access.role', adminBusinessMemberships, 'roleCanManageTeam(access.role)');

  const adminBusinesses = read('src/app/api/admin/businesses/route.ts');
  includes('admin/businesses POST: uses biz gate', adminBusinesses, 'requireBizAccessPatternB(request, workspaceBizId');
  includes('admin/businesses PUT: uses biz gate with business_id', adminBusinesses, 'requireBizAccessPatternB(request, body.business_id');
  includes('admin/businesses PATCH: uses biz gate with anchor biz', adminBusinesses, 'requireBizAccessPatternB(request, anchorBizId');

  const billing = read('src/app/api/billing/route.ts');
  includes('billing POST: uses biz gate', billing, 'requireBizAccessPatternB(request, workspaceBizId');
  includes('billing POST: owner-only via access.role', billing, "access.role !== 'owner'");

  const billingStaffPause = read('src/app/api/billing/staff-ai-paused/route.ts');
  includes('billing/staff-ai-paused POST: uses biz gate', billingStaffPause, 'requireBizAccessPatternB(request, workspaceBizId');
  includes('billing/staff-ai-paused POST: owner/manager role check', billingStaffPause, "(access.role !== 'owner' && access.role !== 'manager')");

  const connectors = read('src/app/api/integrations/connectors/[id]/route.ts');
  includes('connectors/[id]: uses resource helper', connectors, 'requireResourceAccessPatternB(request, routeParams.id, ResourceTable.Connectors');
  ordered('connectors/[id]: gate before connector query', connectors, 'requireResourceAccessPatternB(request, routeParams.id, ResourceTable.Connectors', ".from('connectors')");

  const plannerPatch = read('src/app/api/planner/[id]/route.ts');
  includes('planner/[id]: uses resource helper', plannerPatch, 'requireResourceAccessPatternB(request, routeParams.id, ResourceTable.PlannerItems');
  ordered('planner/[id]: gate before first planner query', plannerPatch, 'requireResourceAccessPatternB(request, routeParams.id, ResourceTable.PlannerItems', ".from('content_planner_items')");
  includes('planner/[id]: item lookup scoped by gate.bizId', plannerPatch, ".eq('business_id', gate.bizId)");

  const plannerSend = read('src/app/api/planner/[id]/send/route.ts');
  includes('planner/[id]/send: uses resource helper', plannerSend, 'requireResourceAccessPatternB(request, routeParams.id, ResourceTable.PlannerItems');
  ordered('planner/[id]/send: gate before first planner query', plannerSend, 'requireResourceAccessPatternB(request, routeParams.id, ResourceTable.PlannerItems', ".from('content_planner_items')");
  includes('planner/[id]/send: item lookup scoped by gate.bizId', plannerSend, ".eq('business_id', gate.bizId)");

  const recommendationFeedback = read('src/app/api/recommendations/[id]/feedback/route.ts');
  includes('recommendations/[id]/feedback: uses resource helper', recommendationFeedback, 'requireResourceAccessPatternB(request, routeParams.id, ResourceTable.RecommendationLog');
  ordered('recommendations/[id]/feedback: gate before recommendation query', recommendationFeedback, 'requireResourceAccessPatternB(request, routeParams.id, ResourceTable.RecommendationLog', ".from('recommendation_log')");
  includes('recommendations/[id]/feedback: scoped by gate.bizId', recommendationFeedback, ".eq('biz_id', gate.bizId)");

  const repliesApprove = read('src/app/api/replies/[replyId]/approve/route.ts');
  includes('replies/[replyId]/approve: uses resource helper', repliesApprove, 'requireResourceAccessPatternB(request, params.replyId, ResourceTable.Replies');
  ordered('replies/[replyId]/approve: gate before reply query', repliesApprove, 'requireResourceAccessPatternB(request, params.replyId, ResourceTable.Replies', ".from('replies')");
  includes('replies/[replyId]/approve: scoped by gate.bizId', repliesApprove, ".eq('biz_id', gate.bizId)");

  const repliesPublish = read('src/app/api/replies/[replyId]/publish/route.ts');
  includes('replies/[replyId]/publish: uses resource helper', repliesPublish, 'requireResourceAccessPatternB(request, params.replyId, ResourceTable.Replies');
  ordered('replies/[replyId]/publish: gate before reply query', repliesPublish, 'requireResourceAccessPatternB(request, params.replyId, ResourceTable.Replies', ".from('replies')");
  includes('replies/[replyId]/publish: scoped by gate.bizId', repliesPublish, ".eq('biz_id', gate.bizId)");

  const threadsClose = read('src/app/api/lito/threads/[threadId]/close/route.ts');
  includes('threads/[threadId]/close: uses resource helper', threadsClose, 'requireResourceAccessPatternB(request, routeParams.threadId, ResourceTable.LitoThreads');
  ordered('threads/[threadId]/close: gate before thread query', threadsClose, 'requireResourceAccessPatternB(request, routeParams.threadId, ResourceTable.LitoThreads', ".from('lito_threads')");
  includes('threads/[threadId]/close: scoped by gate.bizId', threadsClose, ".eq('biz_id', gate.bizId)");

  const threadsMessages = read('src/app/api/lito/threads/[threadId]/messages/route.ts');
  includes('threads/[threadId]/messages: helper uses resource gate', threadsMessages, 'requireResourceAccessPatternB(params.request, params.threadId, ResourceTable.LitoThreads');
  ordered('threads/[threadId]/messages: gate before thread query', threadsMessages, 'requireResourceAccessPatternB(params.request, params.threadId, ResourceTable.LitoThreads', ".from('lito_threads')");

  const voiceDraftDelete = read('src/app/api/lito/voice/drafts/[id]/route.ts');
  includes('lito/voice/drafts/[id]: uses resource helper', voiceDraftDelete, 'requireResourceAccessPatternB(request, routeParams.id, ResourceTable.Drafts');
  ordered('lito/voice/drafts/[id]: gate before draft query', voiceDraftDelete, 'requireResourceAccessPatternB(request, routeParams.id, ResourceTable.Drafts', ".from('lito_action_drafts')");
  includes('lito/voice/drafts/[id]: scoped by gate.bizId', voiceDraftDelete, ".eq('biz_id', gate.bizId)");

  const socialDraftShared = read('src/app/api/social/drafts/_shared.ts');
  includes('social/drafts/_shared: uses resource helper', socialDraftShared, 'requireResourceAccessPatternB(params.request, params.draftId, ResourceTable.Drafts');
  ordered('social/drafts/_shared: gate before social_drafts lookup', socialDraftShared, 'requireResourceAccessPatternB(params.request, params.draftId, ResourceTable.Drafts', ".from('social_drafts')");
  includes('social/drafts/_shared: scoped by gate.bizId', socialDraftShared, ".eq('biz_id', gate.bizId)");

  const schedulesCancel = read('src/app/api/social/schedules/[id]/cancel/route.ts');
  includes('social/schedules/[id]/cancel: uses resource helper', schedulesCancel, 'requireResourceAccessPatternB(request, parsedParams.data.id, ResourceTable.SocialSchedules');
  ordered('social/schedules/[id]/cancel: gate before schedule load', schedulesCancel, 'requireResourceAccessPatternB(request, parsedParams.data.id, ResourceTable.SocialSchedules', 'loadSchedule(parsedParams.data.id, gate.bizId)');

  const schedulesPublish = read('src/app/api/social/schedules/[id]/publish/route.ts');
  includes('social/schedules/[id]/publish: uses resource helper', schedulesPublish, 'requireResourceAccessPatternB(request, parsedParams.data.id, ResourceTable.SocialSchedules');
  ordered('social/schedules/[id]/publish: gate before schedule load', schedulesPublish, 'requireResourceAccessPatternB(request, parsedParams.data.id, ResourceTable.SocialSchedules', 'loadSchedule(parsedParams.data.id, gate.bizId)');

  const schedulesSnooze = read('src/app/api/social/schedules/[id]/snooze/route.ts');
  includes('social/schedules/[id]/snooze: uses resource helper', schedulesSnooze, 'requireResourceAccessPatternB(request, parsedParams.data.id, ResourceTable.SocialSchedules');
  ordered('social/schedules/[id]/snooze: gate before schedule load', schedulesSnooze, 'requireResourceAccessPatternB(request, parsedParams.data.id, ResourceTable.SocialSchedules', 'loadSchedule(parsedParams.data.id, gate.bizId)');

  const teamMember = read('src/app/api/team/member/route.ts');
  includes('team/member: uses memberships resource helper', teamMember, 'requireResourceAccessPatternB(request, id, ResourceTable.Memberships');
  ordered('team/member: gate before memberships query', teamMember, 'requireResourceAccessPatternB(request, id, ResourceTable.Memberships', ".from('memberships')");

  const teamRole = read('src/app/api/team/role/route.ts');
  includes('team/role: uses memberships resource helper', teamRole, 'requireResourceAccessPatternB(request, body.membership_id, ResourceTable.Memberships');
  ordered('team/role: gate before memberships query', teamRole, 'requireResourceAccessPatternB(request, body.membership_id, ResourceTable.Memberships', ".from('memberships')");

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

run();
