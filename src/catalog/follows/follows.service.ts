import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateFollowDto } from './dto/create-follow.dto';
import { UpdateFollowDto } from './dto/update-follow.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Follow } from './entities/follow.entity';
import { Repository } from 'typeorm';

@Injectable()
export class FollowsService {
  constructor(
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
  ) {}


  async toggle(followerId: number, followingId: number){
    if(followerId ===followingId){
      throw new BadRequestException('Bạn không thể theo dõi chính mình')
    }

    const existing = await this.followRepository.findOne({
      where: {follower_id: followerId, following_id: followingId}
    }) 

    if(existing){
      await this.followRepository.remove(existing);
      return{followed: false ,message: 'Đã hủy theo dỗi'}
    }else{
      
      await this.followRepository.save({follower_id: followerId, following_id: followingId })
      return {followed: true, message: 'Đã theo dõi'}
    }
  }

  async isFollowing(followerId: number, followingId: number){
    const count = await this.followRepository.count({
      where: {follower_id: followerId, following_id: followingId},
    })

    return count> 0;
  }

  async countFollowers(userId: number){
    return this.followRepository.count({
      where: {following_id: userId},
    })
  }

  async countFollowings(userId: number){
    return this.followRepository.count({
      where: {follower_id: userId},
    })
  }

  async getFollowers(userId:number, page = 1, limit = 20 ){
    const [result, total] = await this.followRepository.findAndCount({
      where: {following_id: userId},
      relations: ['follower'],
      skip: (page-1)* limit,
      take: limit,
      order: {created_at: 'DESC'},
    })

    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
        total,
      },
      result: result.map((f) => f.follower),
    };
  }

  async getFollowing(userId: number, page = 1, limit = 20){
    const [result, total] = await this.followRepository.findAndCount({
      where: {follower_id: userId},
      relations: ['following'],
      skip: (page-1)*limit,
      take: limit,
      order: { created_at: 'DESC' },
    }) 
    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
        total,
      },
      result: result.map((f) => f.following),
    };
  }

}
