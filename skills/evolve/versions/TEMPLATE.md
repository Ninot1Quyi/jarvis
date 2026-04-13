# Evolve Version Record Template

```markdown
# Evolve v{major}.{minor}.{patch}

## 时间
{YYYY-MM-DD HH:mm:ss +08:00}

## 对标来源
{compare_targets used}

## 差距分析
{gap analysis results}

## 提升项

### [提升项 1]
- **类型**: code | prompt | tool | architecture
- **位置**: {file}:{line}
- **预期收益**: {description}
- **回滚方案**: {rollback plan}

## 编译与测试
- cargo build: {pass|fail}
- cargo test: {pass|fail}
- doctor 技能调用: {yes|no}, 原因: {reason}

## 验证结果
| 维度 | 结果 |
|------|------|
| 功能完整性 | PASS/FAIL |
| 性能表现 | PASS/FAIL |
| 可靠性 | PASS/FAIL |
| 可观测性 | PASS/FAIL |
| 回归影响 | PASS/FAIL |
| 用户体验 | PASS/FAIL |

## 版本号变更
v{before} -> v{after}

## 备注
{additional notes}
```
