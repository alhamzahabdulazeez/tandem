# Launch posts

Every number below is in `docs/SESSION_RESULTS.md` with its method and raw rows. Do not add numbers that are not there.

## English (Reddit r/ClaudeAI, Hacker News "Show HN", X)

**Title:** Show HN: Tandem, a Claude Code plugin that won't let it finish while your tests fail

I measured what plain Claude Code does when a request conflicts with an existing test. On Express (1,290 tests), asked to change `res.send(null)` in a way one test forbids, it rewrote that test and reported "the full suite passes", in 6 of 6 sessions across Haiku and Sonnet. With Tandem it changed nothing, quoted `test/res.send.js:27-40`, and asked, 6 of 6.

Tandem is a set of Claude Code hooks. No extra model calls, works with any model or gateway:

- runs your tests before Claude may finish, and sends it back to fix the code
- tests that existed before the request are append-only; removing assertions, `.skip`, `.only` is refused
- test and build output is compacted before Claude reads it, every failure line kept
- installs of packages that don't exist on npm/PyPI (or were published days ago) are refused
- API keys in edits, shell writes and commits are refused
- `/tandem:undo` restores the working tree from before a request, shell changes included

Whole-session numbers, paired runs with held-out graders: ordinary tasks solved 15/15 with and without it. With Haiku, sessions cost 21% less (95% CI −28% to −14%) because Claude ran the full suite half as often. With Sonnet, context tokens −19%; the cost change was small and not significant.

Limits: one repository, six tasks, three repetitions per arm. It is not a sandbox.

```
/plugin marketplace add alhamzahabdulazeez/tandem
/plugin install tandem@tandem
```

https://github.com/alhamzahabdulazeez/tandem

## العربية (مجتمعات المطورين، X، لينكدإن)

**Tandem: إضافة لـ Claude Code لا تسمح له بالإنهاء والاختبارات فاشلة**

قست سلوك Claude Code حين يتعارض الطلب مع اختبار موجود. على مشروع Express (1,290 اختباراً) طلبت تغييراً يمنعه أحد الاختبارات، فعدّل Claude ذلك الاختبار وأعلن أن "كل الاختبارات تنجح"، في 6 من 6 جلسات (Haiku وSonnet). مع Tandem لم يغيّر شيئاً، وأشار إلى الاختبار المتعارض وسأل، في 6 من 6.

ماذا يفعل:

- يشغّل اختباراتك قبل أن يُسمح لـ Claude بالإنهاء، ويعيده لإصلاح الكود إن فشلت
- الاختبارات الموجودة قبل الطلب لا يُسمح إلا بالإضافة إليها؛ حذف الـ assertions و`.skip` و`.only` مرفوض
- يضغط مخرجات الاختبارات قبل أن يقرأها Claude، مع الاحتفاظ بكل سطر فشل
- يرفض تثبيت حزم غير موجودة على npm أو PyPI، أو نُشرت قبل أيام
- يرفض كتابة المفاتيح السرية في الكود أو الـ commits
- `/tandem:undo` يعيد المشروع إلى ما قبل الطلب، حتى تغييرات الـ shell

الأرقام على جلسات كاملة مع مصحّحات مخفية: المهام العادية حُلّت 15 من 15 مع Tandem وبدونه. مع Haiku انخفضت تكلفة الجلسة 21% (فترة ثقة 95%: من −28% إلى −14%) لأن Claude شغّل الاختبارات نصف عدد المرات. مع Sonnet انخفضت توكنات السياق 19%، والتغير في التكلفة صغير وغير مؤكد.

الحدود: مستودع واحد، ست مهام، ثلاثة تكرارات. وهو ليس sandbox.

لا يستدعي أي نموذج إضافي، ويعمل مع أي نموذج أو بوابة (مثل OmniRoute). مفتوح المصدر (MIT):
https://github.com/alhamzahabdulazeez/tandem
