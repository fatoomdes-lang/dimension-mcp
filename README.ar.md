# dimension-mcp

**خلّ Claude Code أو Codex أو أي برنامج يدعم MCP يتحكّم في Adobe Dimension.** تسوّي موك أب منتجات ومشاهد ثلاثية الأبعاد بالوصف بس: يضيف المجسمات، ويغيّر الخامات والألوان، ويحط الملصقات والشعارات على المنتجات، ويطابق المشهد على صورة خلفية، ويضبط الكاميرا، ويرندر، ويحفظ.

[English](README.md)

> مشروع مستقل من المجتمع، وما له علاقة رسمية بـ Adobe. و«Adobe» و«Adobe Dimension» علامات تجارية لشركة Adobe Inc.

## ليش هذا المشروع

Adobe Dimension ما يدعم السكربتات، وما له أي ربط رسمي مع الذكاء الاصطناعي. لكنه مبني بتقنية Electron، وبرامج Electron تقدر تنفتح بمنفذ تحكم محلي. عن طريق هذا المنفذ، الخادم يوصل لكل أدوات Dimension الداخلية: المشهد، والخامات، والملصقات، والكاميرات، والإضاءة، والرندر، والملفات. فكل تعديل يمشي من نفس طريق الواجهة، ويرجع بـ Cmd+Z أو Ctrl+Z.

## الأدوات

| الأداة | وش تسوي |
|---|---|
| `dimension_launch` | تفتح Dimension بوضع التحكم، أو تتصل فيه إذا كان مفتوح بهالوضع |
| `dimension_status` و`dimension_scene` | الملف المفتوح، وشجرة المشهد بمساراتها |
| `dimension_view` | لقطة من كاميرا الرندر، أو لقطة للنافذة كاملة |
| `dimension_assets` و`dimension_add` | تبحث في أكثر من 570 عنصر جاهز وتضيفها، أو تستورد ملفات OBJ وFBX وGLB وGLTF وSTL وSKP وDN |
| `dimension_transform` | المكان، والدوران، والحجم (بالسنتيمتر والدرجات) |
| `dimension_material` | تقرأ أو تغيّر اللون، والخشونة، والمعدنية، والشفافية، والتوهج، أو صورة texture |
| `dimension_decal` | تحط ملصق أو شعار أو تصميم على المجسم |
| `dimension_background` | تحط صورة خلفية، وتشغّل Match Image للمنظور والإضاءة والمقاس |
| `dimension_camera` | زوايا جاهزة (FRONT، وTOP، وFRONT_RIGHT_TOP، ...) وتأطير |
| `dimension_render` | رندر نهائي PNG |
| `dimension_document` | معلومات الملف، وحفظ، وفتح، وملف جديد |
| `dimension_run` | تشغّل JavaScript داخل Dimension، يعني تحكم كامل بأي شي ثاني |
| `dimension_source` | تبحث في كود Dimension نفسه (ينفك من نسختك المثبتة) عشان تعرف كيف تشتغل أي ميزة |

يشتغل بشكل ممتاز مع خوادم MCP لـ Illustrator وPhotoshop وBlender. مثلاً: تصمم الملصق في Illustrator، وتبني الشكل الناقص في Blender، وتركّب المشهد وترندره في Dimension.

## المتطلبات

- Adobe Dimension 4.x (انجرّب على نسخة 4.1.9 على الماك)
- Node.js نسخة 20 أو أحدث
- برنامج يدعم MCP: Claude Code، أو Codex، أو Claude Desktop، أو Cursor، ...

## التثبيت

الخادم يشتغل مباشرة من هذا المستودع على GitHub عن طريق `npx`، فما تحتاج تنزّل المشروع ولا تبنيه. بس لازم يكون Node.js مثبّت عندك: أمر `node -v` لازم يطلع نسخة 20 أو أحدث.

| | ماك | ويندوز |
|---|---|---|
| Claude Code | مجرّب | المفروض يشتغل، بس ما انجرّب |
| Codex | المفروض يشتغل | المفروض يشتغل، بس ما انجرّب |

### Claude Code على الماك

```bash
claude mcp add dimension --scope user -- npx -y github:fatoomdes-lang/dimension-mcp
```

### Claude Code على الويندوز

على الويندوز، `npx` لازم يشتغل من خلال `cmd /c`:

```bash
claude mcp add dimension --scope user -- cmd /c npx -y github:fatoomdes-lang/dimension-mcp
```

### Codex على الماك

```bash
codex mcp add dimension -- npx -y github:fatoomdes-lang/dimension-mcp
```

### Codex على الويندوز

```bash
codex mcp add dimension -- cmd /c npx -y github:fatoomdes-lang/dimension-mcp
```

### اختياري: الـ Skill (لـ Claude Code)

تعلّم Claude أفضل طريقة شغل في Dimension. أما Codex فيقرأ ملف `AGENTS.md` من المستودع.

على الماك:

```bash
mkdir -p ~/.claude/skills/dimension && curl -fsSL https://raw.githubusercontent.com/fatoomdes-lang/dimension-mcp/main/skills/dimension/SKILL.md -o ~/.claude/skills/dimension/SKILL.md
```

على الويندوز (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills\dimension" | Out-Null; Invoke-WebRequest https://raw.githubusercontent.com/fatoomdes-lang/dimension-mcp/main/skills/dimension/SKILL.md -OutFile "$HOME\.claude\skills\dimension\SKILL.md"
```

بعد ما تضيفه، افتح جلسة جديدة، لأن أدوات MCP تنحمّل بس مع بداية الجلسة.

## الاستخدام

اطلب بكلامك، مثلاً:

> افتح Dimension، وضيف أنبوبة كريم، وخلّ لونها كحلي ولامع، وحط اللوقو ~/Desktop/logo.png على جسمها، وخلّ ~/Desktop/cafe.jpg خلفية وطابق المشهد عليها، وبعدها رندر على سطح المكتب.

إذا كان Dimension مفتوح بالطريقة العادية، المساعد بيطلب منك تحفظ شغلك، وبعدها يعيد تشغيله بوضع التحكم.

## الأمان

ما دام Dimension مفتوح بوضع التحكم، أي برنامج على نفس الجهاز يقدر يتحكم فيه. المنفذ على `127.0.0.1` بس، فما يوصل له أحد من الإنترنت. قفّل Dimension إذا خلصت، ولما تفتحه عادي يرجع طبيعي.

أداة `dimension_source` تفك كود Dimension من **النسخة المثبتة على جهازك أنت**، وتحطه في `~/.dimension-mcp/source`. وما فيه أي كود من Adobe داخل هذا المشروع.

## القيود

- نستخدم أدوات داخلية Adobe ما وثّقتها. ممكن تتغير لو Adobe حدّثت Dimension، لكن تطويره متوقف، فالغالب إنها ما بتتغير.
- اتصال واحد بس في نفس الوقت: جلسة وحدة تقدر تتحكم في Dimension.
- الويندوز المفروض يشتغل بنفس الطريقة، لكن ما انجرّب. إذا جربته، شاركنا النتيجة.

## الرخصة

MIT © فاطمة المحمدي
