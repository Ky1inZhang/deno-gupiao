// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// 创建一个自定义错误类
class StockSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockSearchError";
  }
}

// 定义搜索请求的接口
interface SearchRequest {
  cookie: string;
  query_template: string;
  start_date: string;
  end_date: string;
}

// 在股票数据中查找带日期的字段
function findFieldWithDate(stockData: any, fieldPrefix: string): string | null {
  const pattern = new RegExp(`^${fieldPrefix}\\{[\\d-]+}$`);
  for (const key in stockData) {
    if (pattern.test(key)) {
      return stockData[key];
    }
  }
  return null;
}

// 获取日期区间内的所有日期
function getDateRange(startDate: string, endDate: string): Date[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dateList: Date[] = [];
  let current = new Date(start);

  while (current <= end) {
    if (current.getDay() !== 0 && current.getDay() !== 6) {
      dateList.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  return dateList;
}

// 使用fetch异步调用东方财富选股接口获取股票列表
async function getStockList(date: Date, cookie: string, queryTemplate: string): Promise<any[]> {
  if (!cookie || !queryTemplate) {
    throw new StockSearchError("未设置必要的参数");
  }

  // 替换日期占位符
  const formattedDate = `${date.getMonth() + 1}月${date.getDate()}日`;
  const keyword = queryTemplate.replace("{date}", formattedDate);

  const url = "https://np-tjxg-b.eastmoney.com/api/smart-tag/stock/v3/pw/search-code";

  const headers = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    "actionmode": "input_way",
    "content-type": "application/json",
    "curpage": "stockResult",
    "jumpsource": "input_way",
    "sec-ch-ua": "\"Microsoft Edge\";v=\"135\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "sec-gpc": "1",
    "cookie": cookie,
    "Referer": "https://xuangu.eastmoney.com/",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };

  const payload = {
    "keyWord": keyword,
    "pageSize": 50,
    "pageNo": 1,
    "fingerprint": "5f39288284544d6533677dd3196386c3",
    "gids": [],
    "matchWord": "",
    "timestamp": `${Date.now()}`,
    "shareToGuba": false,
    "requestId": `WHTwdPO3E78pv2KHSe1PIklpkot2mXmh${Date.now()}`,
    "needCorrect": true,
    "removedConditionIdList": [],
    "xcId": "xc0a4c4545da08014827",
    "ownSelectAll": false,
    "dxInfo": [],
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const result = await response.json();
      if (result.code === "100" && result.data?.result?.dataList) {
        const stocks = result.data.result.dataList;
        const stockInfo = stocks.map((stock: any) => {
          const zsValue = findFieldWithDate(stock, "ZS");
          return {
            date: formattedDate,
            name: stock.SECURITY_SHORT_NAME,
            code: stock.SECURITY_CODE,
            chg: stock.CHG,
            zs: zsValue,
          };
        });
        return stockInfo;
      } else {
        throw new StockSearchError(`接口返回错误: ${result.msg}`);
      }
    } else {
      throw new StockSearchError(`请求失败，状态码: ${response.status}`);
    }
  } catch (error) {
    throw new StockSearchError(`发生错误: ${error.message}`);
  }
}

// 处理根路径请求
async function handleHome() {
  const html = await Deno.readTextFile("./index.html");
  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

// 处理搜索请求
async function handleSearch(request: Request): Promise<Response> {
  try {
    const { cookie, query_template, start_date, end_date } = await request.json() as SearchRequest;
    const dates = getDateRange(start_date, end_date);
    console.log(`将查询以下日期: ${dates.map((d) => d.toISOString().split("T")[0])}`);

    const tasks = dates.map((date) => getStockList(date, cookie, query_template));
    const results = await Promise.all(tasks);

    const allStocks: any[] = [];
    for (const result of results) {
      if (result) {
        allStocks.push(...result);
      }
    }

    if (allStocks.length > 0) {
      const dateStats: { [date: string]: number } = {};
      for (const stock of allStocks) {
        const date = stock.date;
        if (!dateStats[date]) {
          dateStats[date] = 0;
        }
        dateStats[date]++;
      }

      console.log("各日期数据统计:");
      for (const [date, count] of Object.entries(dateStats)) {
        console.log(`${date}: ${count}条`);
      }

      return new Response(JSON.stringify({ success: true, data: allStocks }), {
        headers: { "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({ success: false, message: "未获取到数据" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    if (error instanceof StockSearchError) {
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: false, message: "发生未知错误" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}

// 主请求处理函数
async function handler(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/") {
    return await handleHome();
  } else if (pathname === "/search") {
    return await handleSearch(request);
  }
  return new Response("Not Found", { status: 404 });
}

// 启动服务器
console.log("Server running on http://localhost:8001");
serve(handler, { port: 8001 });