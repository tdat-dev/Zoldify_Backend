import { AssistantModel } from './assistant-model';

/**
 * Đo staging 13/11 (150 lượt): router 9router trả 503 năm lần, mỗi lần trong
 * khoảng 0,5 giây. Còn nhiều thời gian trong ngân sách nên thử lại một lần.
 */
describe('AssistantModel: thử lại khi router bận', () => {
  const realFetch = global.fetch;
  const key = process.env.AI_API_KEY;
  const toolCall = JSON.stringify({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                name: 'search_products',
                arguments: JSON.stringify({ q: 'nồi cơm' }),
              },
            },
          ],
        },
      },
    ],
  });
  beforeEach(() => {
    process.env.AI_API_KEY = 'test';
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env.AI_API_KEY = key;
  });

  it('503 rồi 200 thì vẫn hiểu được câu', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(toolCall, { status: 200 }));
    global.fetch = fetchMock;

    const out = await new AssistantModel().understand([
      { role: 'user', content: 'nồi cơm' },
    ]);
    expect(out.filters?.q).toBe('nồi cơm');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('503 hai lần thì báo lỗi, không thử mãi', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response('busy', { status: 503 }));
    global.fetch = fetchMock;

    await expect(
      new AssistantModel().understand([{ role: 'user', content: 'nồi' }]),
    ).rejects.toThrow('503');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
