# 导入模板说明

标准模板字段：

- `channel_name`
- `game_name`
- `gross_amount`

示例：

```csv
channel_name,game_name,gross_amount
渠道A,游戏X,100000
渠道B,游戏Y,80000
```

注意：

- 仅导入原始数据，不导入利润、结算金额等计算结果
- 汇总行（合计/小计）应在导入前剔除，或使用原表提取导入功能自动过滤
