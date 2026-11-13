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

  /**
   * Đo staging 13/11: "quà tặng bạn gái" có lượt mô hình gợi ý toàn món sàn
   * không bán (nước hoa, trang sức) nên ra rỗng. Đưa danh mục sàn đang có vào
   * câu dặn để mô hình gợi ý trong đó.
   */
  it('câu dặn mô hình có danh mục sàn đang có', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response(toolCall, { status: 200 }));
    global.fetch = fetchMock;

    await new AssistantModel().understand(
      [{ role: 'user', content: 'quà tặng bạn gái' }],
      ['Đồng hồ', 'Quần áo'],
    );
    const sent = String(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    );
    expect(sent).toContain('Đồng hồ, Quần áo');
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
